-- Optional sample taxonomy for a fresh project (safe to skip or edit). Not required by the application.
insert into public.categories (slug, name_en, name_ar, position) values
  ('programming', 'Programming', 'البرمجة', 1),
  ('design',      'Design',      'التصميم', 2),
  ('business',    'Business',    'الأعمال', 3),
  ('languages',   'Languages',   'اللغات', 4),
  ('science',     'Science',     'العلوم', 5)
on conflict (slug) do nothing;
