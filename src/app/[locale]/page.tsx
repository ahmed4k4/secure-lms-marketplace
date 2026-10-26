import Link from "next/link";
import { ArrowUpLeft, ArrowUpRight, BookOpenCheck, Check, CircuitBoard, GraduationCap, Play, Search, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ar = locale === "ar";
  const supabase = await createClient();
  const [{ data: featured }, { data: categories }] = await Promise.all([
    supabase.from("courses").select("id,slug,title_ar,title_en,summary_ar,summary_en,level,language,thumbnail_url").eq("status", "published").order("published_at", { ascending: false }).limit(3),
    supabase.from("categories").select("id,slug,name_ar,name_en").order("sort_order", { ascending: true }).limit(6),
  ]);
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const Arrow = ar ? ArrowUpLeft : ArrowUpRight;

  return <>
    <section className="hero">
      <div className="hero-circuit hero-circuit-a" aria-hidden="true" />
      <div className="hero-circuit hero-circuit-b" aria-hidden="true" />
      <div className="container hero-layout">
        <div className="hero-copy">
          <span className="eyebrow"><span className="eyebrow-pulse" />{t("A focused learning marketplace", "منصة تعليمية بمسار واضح")}</span>
          <h1>{t("Build a skill.\nOpen a new path.", "ابنِ مهارة.\nوافتح لنفسك طريق جديد.")}</h1>
          <p>{t("Learn from people who do the work. Explore practical courses, follow a clear curriculum, and turn each lesson into progress you can feel.", "اتعلم من ناس بتطبّق فعلًا. استكشف كورسات عملية، وامشِ في منهج واضح، وحوّل كل درس لخطوة حقيقية لقدّام.")}</p>
          <form className="hero-search" action={`/${locale}/courses`} method="get" role="search">
            <Search size={20} aria-hidden="true" />
            <label className="visually-hidden" htmlFor={`home-course-search-${locale}`}>{t("Search courses and skills", "ابحث عن كورسات ومهارات")}</label>
            <input id={`home-course-search-${locale}`} type="search" name="q" maxLength={80} placeholder={t("What do you want to learn?", "عاوز تتعلم إيه؟")} />
            <button className="button button-primary" type="submit">{t("Find courses", "دور على كورس")}<Arrow size={17} aria-hidden="true" /></button>
          </form>
          {categories?.length ? <div className="hero-topic-links"><span>{t("POPULAR TOPICS", "مجالات تقدر تبدأ منها")}</span>{categories.slice(0, 4).map((category) => <Link key={category.id} href={`/${locale}/courses?category=${encodeURIComponent(category.slug)}`}>{ar ? category.name_ar : category.name_en}</Link>)}</div> : null}
          <div className="hero-proof"><span><Check size={15}/>{t("Learn at your pace", "اتعلم على وقتك")}</span><span><Check size={15}/>{t("Protected lessons", "دروس محمية")}</span><span><Check size={15}/>{t("Arabic & English", "عربي وإنجليزي")}</span></div>
          <div className="hero-actions"><Link className="button button-primary" href={`/${locale}/courses`}>{t("Explore courses", "استكشف الكورسات")}<Arrow size={17} aria-hidden="true" /></Link><Link className="hero-secondary-link" href={`/${locale}/sign-up`}>{t("Create your free account", "أنشئ حسابك المجاني")}<Arrow size={15} aria-hidden="true" /></Link></div>
        </div>

        <div className="hero-visual" role="img" aria-label={t("Illustration of a structured learning workspace", "تصميم توضيحي لمساحة تعلّم منظمة")}>
          <div className="hero-visual-orbit orbit-one" aria-hidden="true" />
          <div className="hero-visual-orbit orbit-two" aria-hidden="true" />
          <div className="hero-core"><CircuitBoard size={60} strokeWidth={1.1}/><span className="hero-core-node" /></div>
          <div className="hero-float-card hero-float-top"><span className="hero-float-icon"><Zap size={16}/></span><span><small>{t("LEARNING PATH", "مسار التعلّم")}</small><strong>{t("One step at a time", "خطوة ورا خطوة")}</strong></span><span className="hero-float-dot" /></div>
          <div className="hero-float-card hero-float-bottom"><span className="hero-float-icon copper"><Play size={16}/></span><span><small>{t("COURSE FORMAT", "نظام الكورس")}</small><strong>{t("Lessons · Practice · Progress", "دروس · تطبيق · تقدّم")}</strong></span></div>
          <div className="hero-visual-caption"><span className="caption-line"/><span>{t("LEARN / APPLY / ADVANCE", "تعلّم / طبّق / اتقدّم")}</span></div>
        </div>
      </div>
      <div className="hero-bottom-rail" aria-hidden="true"><span>01 / DISCOVER</span><span>02 / LEARN</span><span>03 / GROW</span></div>
    </section>

    {categories?.length ? <section className="section category-section" id="categories"><div className="container"><div className="section-heading-row"><div><span className="section-kicker">01 / {t("FIND YOUR FIELD", "اختار مجالك")}</span><h2>{t("A good next step starts with a topic.", "الخطوة الصح بتبدأ باختيار المجال.")}</h2><p className="muted">{t("Start broad, then choose the skill you want to take further.", "ابدأ بالمجال، وبعدها اختار المهارة اللي عاوز تتعمق فيها.")}</p></div><Link className="text-link" href={`/${locale}/courses`}>{t("View the catalog", "شوف كل الكورسات")}<Arrow size={16}/></Link></div><div className="category-pills">{categories.map((category, index) => <Link href={`/${locale}/courses?category=${encodeURIComponent(category.slug)}`} key={category.id} className="category-pill"><span className="category-pill-index">0{index + 1}</span><span className="category-pill-title">{ar ? category.name_ar : category.name_en}</span><span className="category-pill-arrow"><Arrow size={16}/></span></Link>)}</div></div></section> : null}

    <section className="section featured-section"><div className="container"><div className="section-heading-row"><div><span className="section-kicker">02 / {t("RECENT RELEASES", "أحدث الإضافات")}</span><h2>{t("Find a course worth your time.", "اختار كورس يستاهل وقتك.")}</h2><p className="muted">{t("Recently published learning from instructors on the platform.", "أحدث الكورسات المنشورة من المدرّسين على المنصة.")}</p></div><Link className="button button-outline" href={`/${locale}/courses`}>{t("Browse all courses", "تصفح كل الكورسات")}<Arrow size={16}/></Link></div>
      {!featured?.length ? <div className="featured-empty panel"><div className="empty-illustration"><BookOpenCheck size={26}/></div><h3>{t("Your next chapter starts here", "خطوتك الجديدة تبدأ هنا")}</h3><p className="muted">{t("New courses will appear here as instructors publish them.", "هتظهر الكورسات هنا أول ما المدرّسين ينشروها بعد المراجعة.")}</p><Link className="button button-primary" href={`/${locale}/courses`}>{t("Explore the catalog", "استكشف الكتالوج")}<Arrow size={16}/></Link></div> : <div className="course-card-grid">{featured.map((course, index) => <article className="course-card" key={course.id}><Link href={`/${locale}/courses/${course.slug}`} className={`course-card-art course-art-${index + 1}`} aria-label={ar ? `عرض ${course.title_ar}` : `View ${course.title_en}`} style={course.thumbnail_url ? { backgroundImage: `linear-gradient(135deg,rgba(27,34,40,.12),rgba(7,115,155,.32)),url("${course.thumbnail_url}")` } : undefined}><span className="course-art-badge">{t("PUBLISHED COURSE", "كورس منشور")}</span><span className="course-art-mark">{(ar ? course.title_ar : course.title_en).slice(0, 1)}</span><span className="course-art-corner" aria-hidden="true"><Arrow size={18}/></span></Link><div className="course-card-body"><div className="course-card-meta"><span>{course.language === "both" ? t("AR + EN", "عربي + إنجليزي") : course.language === "en" ? "ENGLISH" : t("ARABIC", "العربية")}</span><span>{course.level === "all_levels" ? t("ALL LEVELS", "كل المستويات") : String(course.level).replaceAll("_", " ").toUpperCase()}</span></div><h3><Link href={`/${locale}/courses/${course.slug}`}>{ar ? course.title_ar : course.title_en}</Link></h3><p className="muted">{ar ? course.summary_ar : course.summary_en}</p><Link className="course-card-link" href={`/${locale}/courses/${course.slug}`}>{t("View course details", "شوف تفاصيل الكورس")}<Arrow size={16}/></Link></div></article>)}</div>}
    </div></section>

    <section className="section benefits-section"><div className="container"><div className="benefits-intro"><span className="section-kicker">03 / {t("DESIGNED TO HELP YOU MOVE", "مصممة عشان تتقدم")}</span><h2>{t("Learning should feel clear, not complicated.", "التعلّم المفروض يكون واضح، مش معقّد.")}</h2><p className="muted">{t("Every part of the experience is built around finding your course, following the material, and seeing your progress.", "كل جزء في التجربة هدفه يساعدك تلاقي الكورس المناسب، تتابع محتواه، وتشوف تقدمك.")}</p></div><div className="feature-grid"><article className="benefit-card"><span className="benefit-icon"><BookOpenCheck size={21}/></span><span className="benefit-number">01 / STRUCTURE</span><h3>{t("A path you can follow", "مسار تقدر تكمله")}</h3><p className="muted">{t("Lessons and sections arranged into a curriculum that makes your next step clear.", "دروس وأقسام مترتبة في منهج يوضّح لك الخطوة اللي جاية.")}</p></article><article className="benefit-card"><span className="benefit-icon copper"><GraduationCap size={21}/></span><span className="benefit-number">02 / CREATE</span><h3>{t("Built for instructors", "مساحة للمدرّسين")}</h3><p className="muted">{t("Create drafts, organize lessons, and set access and pricing from one workspace.", "أنشئ مسودات، ورتّب الدروس، وحدد الأسعار والوصول من مساحة واحدة.")}</p></article><article className="benefit-card"><span className="benefit-icon"><ShieldCheck size={21}/></span><span className="benefit-number">03 / TRUST</span><h3>{t("Protected by design", "الحماية جزء من التصميم")}</h3><p className="muted">{t("Server-checked permissions help keep private lessons available only to authorized learners.", "التحقق من الصلاحيات على الخادم يساعد في قصر الدروس الخاصة على الطلاب المصرح لهم.")}</p></article></div></div></section>

    <section className="cta-section"><div className="container cta-panel"><div className="cta-panel-mark" aria-hidden="true"><Sparkles size={26}/></div><div className="cta-panel-copy"><span className="section-kicker">04 / {t("YOUR NEXT STEP", "خطوتك القادمة")}</span><h2>{t("Your next skill is closer than you think.", "المهارة اللي جاية أقرب مما تتخيّل.")}</h2><p>{t("Find a course that matches your goal and start making progress today.", "اختار كورس يناسب هدفك وابدأ تتقدم من النهارده.")}</p></div><Link className="button button-primary" href={`/${locale}/sign-up`}>{t("Start learning", "ابدأ التعلّم")}<Arrow size={17}/></Link><div className="cta-circuit" aria-hidden="true"/></div></section>
  </>;
}
