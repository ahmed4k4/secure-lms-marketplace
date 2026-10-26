import { describe, it, expect } from 'vitest';
import { COVER_TYPES, RESOURCE_TYPES, VIDEO_TYPES, resourceKey, sanitizeFilename, sniffCover, sniffMatchesType, sniffVideo, videoKey } from '@/lib/media-rules';

const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);

describe('video sniffing', () => {
  it('recognises mp4 and webm', () => {
    expect(sniffVideo(mp4)).toBe('mp4');
    expect(sniffVideo(webm)).toBe('webm');
  });
  it('rejects executables, html and truncated input', () => {
    expect(sniffVideo(new TextEncoder().encode('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffVideo(new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0]))).toBeNull();
    expect(sniffVideo(new Uint8Array([1, 2]))).toBeNull();
  });
  it('requires the declared type to match the content', () => {
    expect(sniffMatchesType('mp4', 'video/mp4')).toBe(true);
    expect(sniffMatchesType('mp4', 'video/webm')).toBe(false);
    expect(sniffMatchesType('webm', 'video/webm')).toBe(true);
    expect(sniffMatchesType(null, 'video/mp4')).toBe(false);
  });
});

describe('object keys and filenames', () => {
  it('sanitizes traversal and odd characters', () => {
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('/');
    expect(sanitizeFilename('..\\..\\x.pdf')).not.toContain('\\');
    expect(sanitizeFilename('my file (1).pdf')).toBe('my-file-1.pdf');
    expect(sanitizeFilename('....')).toBe('file');
  });
  it('builds private, unguessable, scoped keys', () => {
    const k = videoKey('course-1', 'lesson-1', 'video/mp4');
    expect(k).toMatch(/^videos\/course-1\/lesson-1\/[0-9a-f-]{36}\.mp4$/);
    expect(videoKey('c', 'l', 'video/mp4')).not.toBe(videoKey('c', 'l', 'video/mp4'));
    expect(resourceKey('c', 'l', '../x.pdf')).toMatch(/^resources\/c\/l\/[0-9a-f-]{36}-x\.pdf$/);
    expect(() => videoKey('c', 'l', 'application/x-msdownload')).toThrow();
  });
  it('allow-lists only safe types (no html/svg/js/exe)', () => {
    for (const bad of ['text/html', 'image/svg+xml', 'application/javascript', 'application/x-msdownload']) {
      expect(RESOURCE_TYPES[bad]).toBeUndefined();
      expect(VIDEO_TYPES[bad]).toBeUndefined();
    }
  });
});


describe('course cover image validation', () => {
  it('recognises JPEG, PNG and WebP signatures', () => {
    expect(sniffCover(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(sniffCover(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(sniffCover(new TextEncoder().encode('RIFF----WEBP'))).toBe('webp');
  });
  it('rejects SVG, HTML and content that does not match an allowed raster format', () => {
    expect(sniffCover(new TextEncoder().encode('<svg onload="alert(1)">'))).toBeNull();
    expect(sniffCover(new TextEncoder().encode('<html>cover</html>'))).toBeNull();
    expect(COVER_TYPES['image/svg+xml']).toBeUndefined();
    expect(sniffCover(new Uint8Array([0, 1, 2]))).toBeNull();
  });
});
