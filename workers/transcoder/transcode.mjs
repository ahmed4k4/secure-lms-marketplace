import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const env = process.env;
const required = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
for (const name of required) if (!env[name]) throw new Error(`Missing environment variable ${name}`);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, forcePathStyle: true, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });
const bucket = env.R2_BUCKET;
const idleMs = Math.max(1000, Number(env.TRANSCODER_POLL_MS ?? 2500));
const maxJobs = Math.max(1, Number(env.TRANSCODER_MAX_JOBS ?? 1));

function run(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (chunk) => { if (out.length < 12000) out += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { if (err.length < 20000) err += chunk.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(`${command} exited ${code}: ${err.slice(-4000)}`)));
  });
}

async function downloadObject(key, target) {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error(`Source object ${key} has no body`);
  await pipeline(result.Body, createWriteStream(target));
}

async function uploadTree(dir, prefix, rootDir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await uploadTree(full, prefix, rootDir);
    else {
      const relative = path.relative(rootDir, full).split(path.sep).join('/');
      const key = `${prefix}/${relative}`;
      const info = await stat(full);
      const contentType = entry.name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : entry.name.endsWith('.ts') ? 'video/mp2t' : 'application/octet-stream';
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: createReadStream(full), ContentLength: info.size, ContentType: contentType, CacheControl: 'private, no-store, max-age=0' }));
    }
  }
}
async function transcode(job) {
  const root = await mkdtemp(path.join(tmpdir(), 'archai-hls-'));
  const out = path.join(root, 'out');
  const source = path.join(root, 'source.bin');
  try {
    await mkdir(out, { recursive: true });
    console.log(`[job:${job.id}] downloading source ${job.source_key}`);
    await downloadObject(job.source_key, source);
    const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=height,width', '-of', 'json', source]);
    const streams = JSON.parse(probe).streams ?? [];
    const sourceHeight = Number(streams[0]?.height ?? 0);
    if (sourceHeight < 144) throw new Error('Could not detect a valid video stream or resolution.');
    const { data: settingRow, error: settingError } = await supabase.from('platform_settings').select('value').eq('key', 'hls_max_height').maybeSingle();
    if (settingError) throw new Error(`could not read platform video-quality setting: ${settingError.message}`);
    const configuredCap = Number(settingRow?.value ?? 1080);
    const maxHeight = [360, 480, 720, 1080].includes(configuredCap) ? configuredCap : 1080;
    const cap = Math.min(sourceHeight, maxHeight);
    const targets = [360, 480, 720, 1080].filter((height) => height <= cap);
    if (!targets.length) targets.push(Math.max(144, cap - (cap % 2)));
    const uniqueTargets = [...new Set(targets)].sort((a, b) => a - b);
    const variants = [];
    for (const height of uniqueTargets) {
      const name = `${height}p`;
      const folder = path.join(out, name);
      await mkdir(folder, { recursive: true });
      const videoRate = height >= 1080 ? 5000 : height >= 720 ? 2800 : height >= 480 ? 1400 : height >= 360 ? 800 : 400;
      const rate = `${videoRate}k`;
      await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
        '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', `scale=-2:${height}:force_original_aspect_ratio=decrease`,
        '-c:v', 'libx264', '-preset', env.FFMPEG_PRESET ?? 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
        '-b:v', rate, '-maxrate', `${Math.ceil(videoRate * 1.08)}k`, '-bufsize', `${videoRate * 2}k`,
        '-c:a', 'aac', '-b:a', height >= 720 ? '128k' : '96k', '-ac', '2',
        '-hls_time', '6', '-hls_playlist_type', 'vod', '-hls_flags', 'independent_segments',
        '-hls_segment_filename', path.join(folder, 'segment_%05d.ts'), '-f', 'hls', path.join(folder, 'index.m3u8'),
      ]);
      const info = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', path.join(folder, 'index.m3u8')]).catch(() => '');
      variants.push({ name, height, bandwidth: videoRate * 1000 + 128000, resolution: info ? JSON.parse(info).streams?.[0] : undefined });
    }
    const master = ['#EXTM3U', '#EXT-X-VERSION:3'];
    for (const variant of variants) {
      const resolution = variant.resolution?.width && variant.resolution?.height ? `,RESOLUTION=${variant.resolution.width}x${variant.resolution.height}` : '';
      master.push(`#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},AVERAGE-BANDWIDTH=${variant.bandwidth}${resolution}`);
      master.push(`${variant.name}/index.m3u8`);
    }
    await (await import('node:fs/promises')).writeFile(path.join(out, 'master.m3u8'), `${master.join('\n')}\n`, 'utf8');
    await uploadTree(out, job.output_prefix, out);
    const manifestKey = `${job.output_prefix}/master.m3u8`;
    const { error: videoError } = await supabase.from('lesson_videos').update({ processing_status: 'ready', stream_manifest_key: manifestKey, processing_error: null, last_processed_at: new Date().toISOString() }).eq('lesson_id', job.lesson_id).eq('object_key', job.source_key);
    if (videoError) throw new Error(`could not update lesson video status: ${videoError.message}`);
    const { error: jobError } = await supabase.from('video_transcode_jobs').update({ status: 'completed', finished_at: new Date().toISOString(), last_error: null }).eq('id', job.id);
    if (jobError) throw new Error(`could not complete transcode job: ${jobError.message}`);
    console.log(`[job:${job.id}] completed at ${manifestKey} with ${variants.map((v) => v.name).join(', ')}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function handleJob(job) {
  const heartbeat = setInterval(() => {
    void supabase.from('video_transcode_jobs').update({ heartbeat_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'processing')
      .then(({ error }) => { if (error) console.error(`[job:${job.id}] heartbeat update failed: ${error.message}`); });
  }, 30_000);
  try {
    await transcode(job);
  } catch (error) {
    const message = String(error?.message ?? error).slice(0, 3000);
    console.error(`[job:${job.id}] ${message}`);
    const terminal = Number(job.attempts ?? 1) >= 3;
    await supabase.from('video_transcode_jobs').update({ status: terminal ? 'failed' : 'queued', last_error: message, ...(terminal ? { finished_at: new Date().toISOString() } : {}) }).eq('id', job.id);
    if (terminal) await supabase.from('lesson_videos').update({ processing_status: 'failed', processing_error: message, last_processed_at: new Date().toISOString() }).eq('lesson_id', job.lesson_id);
  } finally {
    clearInterval(heartbeat);
  }
}

console.log(`[archai-transcoder] started; polling every ${idleMs}ms, max jobs ${maxJobs}`);
while (true) {
  const claimed = [];
  for (let i = 0; i < maxJobs; i++) {
    const { data, error } = await supabase.rpc('claim_video_transcode_job');
    if (error) { console.error('[worker] queue claim failed:', error.message); break; }
    const job = Array.isArray(data) ? data[0] : data;
    if (!job) break;
    claimed.push(job);
  }
  if (claimed.length) await Promise.all(claimed.map(handleJob));
  else await new Promise((resolve) => setTimeout(resolve, idleMs));
}
