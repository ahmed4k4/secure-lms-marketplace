import Link from 'next/link';
import { requireInstructor } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { Badge, Card, CardBody, EmptyState } from '@/components/ui/primitives';
import { buttonVariants } from '@/components/ui/button';
import { cn, formatDate } from '@/lib/utils';

export const metadata = { title: 'Instructor dashboard' };
const TONE: Record<string, 'neutral' | 'success' | 'warn' | 'danger'> = { draft: 'neutral', category_pending: 'warn', in_review: 'warn', published: 'success', rejected: 'danger', suspended: 'danger', archived: 'neutral' };

export default async function InstructorHome() {
  const { supabase, user } = await requireInstructor();
  const { t, locale } = await getT();
  const { data: rows, error: courseError } = await supabase.from('course_instructors').select('courses(id, title, status, updated_at)').eq('instructor_id', user.id);
  const courses = (rows ?? []).map((r: any) => (Array.isArray(r.courses) ? r.courses[0] : r.courses)).filter(Boolean)
    .sort((a: any, b: any) => +new Date(b.updated_at) - +new Date(a.updated_at));
  const ids = courses.map((c: any) => c.id);
  const [enrollResult, quizResult, assignmentResult, discussionResult] = ids.length ? await Promise.all([
    supabase.from('enrollments').select('course_id,user_id').in('course_id', ids),
    supabase.from('quizzes').select('id,course_id,title,is_published').in('course_id', ids),
    supabase.from('assignments').select('id,course_id,title,is_published').in('course_id', ids),
    supabase.from('discussions').select('id,course_id,is_resolved').in('course_id', ids),
  ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  const assignmentIds = (assignmentResult.data ?? []).map((a: any) => a.id);
  const submissionResult = assignmentIds.length ? await supabase.from('submissions').select('id,assignment_id,score,graded_at').in('assignment_id', assignmentIds) : { data: [], error: null };
  const enrollments = enrollResult.data ?? [];
  const quizzes = quizResult.data ?? [];
  const assignments = assignmentResult.data ?? [];
  const submissions = submissionResult.data ?? [];
  const discussions = discussionResult.data ?? [];
  const pendingGrading = submissions.filter((s: any) => s.graded_at == null).length;
  const openQuestions = discussions.filter((d: any) => !d.is_resolved).length;
  const dataError = courseError?.message || enrollResult.error?.message || quizResult.error?.message || assignmentResult.error?.message || discussionResult.error?.message || submissionResult.error?.message;
  const tiles = [
    { label: locale === 'ar' ? 'كورساتي' : 'My courses', value: courses.length },
    { label: locale === 'ar' ? 'التسجيلات' : 'Enrollments', value: enrollments.length },
    { label: locale === 'ar' ? 'الاختبارات' : 'Quizzes', value: quizzes.length },
    { label: locale === 'ar' ? 'الواجبات' : 'Assignments', value: assignments.length },
    { label: locale === 'ar' ? 'تحتاج تصحيحًا' : 'Awaiting grading', value: pendingGrading },
    { label: locale === 'ar' ? 'أسئلة مفتوحة' : 'Open questions', value: openQuestions },
  ];

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl">{t('instr.title')}</h1><p className="mt-1 text-sm text-muted-foreground">{locale === 'ar' ? 'أنشئ الكورسات ونظّم المحتوى والاختبارات والواجبات وتابع تقدم الطلاب.' : 'Create courses, organize lessons and assessments, and track student progress.'}</p></div><Link href="/instructor/courses/new" className={cn(buttonVariants())}>{t('instr.new_course')}</Link></div>
    {dataError && <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">{locale === 'ar' ? `تعذر تحميل بعض بيانات لوحة المدرس: ${dataError}` : `Some instructor dashboard data could not be loaded: ${dataError}`}</div>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{tiles.map((tile) => <Card key={tile.label}><CardBody><p className="text-xs text-muted-foreground">{tile.label}</p><p className="mt-2 font-display text-3xl tabular-nums">{tile.value}</p></CardBody></Card>)}</div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Link href="/instructor/finance" className="rounded-xl border border-border bg-card p-4 hover:border-arc"><p className="font-semibold">{locale === 'ar' ? 'الأرباح والسحب' : 'Earnings & payouts'}</p><p className="mt-1 text-sm text-muted-foreground">{locale === 'ar' ? 'راجع الأرباح المتاحة واطلب سحب رصيدك بعد التسوية' : 'Review settled earnings and request a payout'}</p></Link>
      <Link href="/instructor/courses/new" className="rounded-xl border border-border bg-card p-4 hover:border-arc"><p className="font-semibold">{locale === 'ar' ? 'إنشاء كورس' : 'Create a course'}</p><p className="mt-1 text-sm text-muted-foreground">{locale === 'ar' ? 'بيانات الكورس والتصنيف والغلاف' : 'Course details, category, and cover'}</p></Link>
      {courses[0] && <Link href={`/instructor/courses/${courses[0].id}/assessments`} className="rounded-xl border border-border bg-card p-4 hover:border-arc"><p className="font-semibold">{locale === 'ar' ? 'إدارة الاختبارات والواجبات' : 'Manage quizzes & assignments'}</p><p className="mt-1 text-sm text-muted-foreground">{locale === 'ar' ? 'أنشئ اختبارًا أو واجبًا وصحح التسليمات' : 'Create assessments and grade submissions'}</p></Link>}
      {courses[0] && <Link href={`/instructor/courses/${courses[0].id}/students`} className="rounded-xl border border-border bg-card p-4 hover:border-arc"><p className="font-semibold">{locale === 'ar' ? 'متابعة الطلاب' : 'Manage students'}</p><p className="mt-1 text-sm text-muted-foreground">{locale === 'ar' ? 'التسجيلات والتقدم والدرجات' : 'Enrollments, progress, and grades'}</p></Link>}
      {courses[0] && <Link href={`/instructor/courses/${courses[0].id}/questions`} className="rounded-xl border border-border bg-card p-4 hover:border-arc"><p className="font-semibold">{locale === 'ar' ? 'أسئلة الطلاب' : 'Student Q&A'}</p><p className="mt-1 text-sm text-muted-foreground">{locale === 'ar' ? 'الإجابة عن الأسئلة ومتابعة النقاشات' : 'Reply to questions and follow discussions'}</p></Link>}
    </div>
    {courses.length ? <div className="overflow-x-auto rounded-xl border border-border bg-card"><table className="w-full text-sm"><thead className="bg-muted text-start"><tr><th className="p-3 text-start">{t('instr.col_course')}</th><th className="p-3 text-start">{t('instr.col_status')}</th><th className="p-3 text-start">{t('instr.col_students')}</th><th className="p-3 text-start">{locale === 'ar' ? 'التقييمات' : 'Assessments'}</th><th className="p-3 text-start">{t('instr.col_updated')}</th><th className="p-3 text-start">{t('admin.actions')}</th></tr></thead><tbody>{courses.map((c: any) => {
      const studentCount = new Set(enrollments.filter((e: any) => e.course_id === c.id).map((e: any) => e.user_id)).size;
      const courseQuizzes = quizzes.filter((a: any) => a.course_id === c.id).length;
      const courseAssignments = assignments.filter((a: any) => a.course_id === c.id).length;
      return <tr key={c.id} className="border-t border-border"><td className="p-3"><Link className="font-medium text-primary hover:underline" href={`/instructor/courses/${c.id}`}>{c.title}</Link></td><td className="p-3"><Badge tone={TONE[c.status] ?? 'neutral'}>{t(`status.${c.status}` as never)}</Badge></td><td className="p-3">{studentCount}</td><td className="p-3"><Link className="text-primary underline" href={`/instructor/courses/${c.id}/assessments`}>{courseQuizzes} {locale === 'ar' ? 'اختبار' : 'quizzes'} · {courseAssignments} {locale === 'ar' ? 'واجب' : 'assignments'}</Link></td><td className="p-3 text-muted-foreground">{formatDate(c.updated_at, locale)}</td><td className="p-3"><div className="flex flex-wrap gap-2"><Link className="text-primary underline" href={`/instructor/courses/${c.id}`}>{locale === 'ar' ? 'تحرير' : 'Edit'}</Link><Link className="text-primary underline" href={`/instructor/courses/${c.id}/students`}>{locale === 'ar' ? 'الطلاب' : 'Students'}</Link><Link className="text-primary underline" href={`/instructor/courses/${c.id}/questions`}>{locale === 'ar' ? 'الأسئلة' : 'Q&A'}</Link></div></td></tr>;
    })}</tbody></table></div> : <EmptyState title={t('instr.empty')} hint={t('instr.empty_hint')} />}
  </div>;
}
