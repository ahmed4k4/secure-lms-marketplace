-- =====================================================================
-- 0004_seed_config.sql — roles, permissions and default platform settings.
-- This is configuration the application requires, not demo data.
-- =====================================================================
insert into public.roles (key, name) values
  ('super_admin', 'Super Admin'),
  ('admin',       'Administrator'),
  ('instructor',  'Instructor'),
  ('student',     'Student');

insert into public.permissions (key, description) values
  ('users.manage',        'View users, suspend/activate accounts'),
  ('instructors.manage',  'Create and manage instructor accounts'),
  ('admins.manage',       'Manage administrators and role assignments'),
  ('courses.review',      'Approve, reject, suspend and archive courses'),
  ('courses.manage',      'Edit or delete any course'),
  ('categories.manage',   'Manage categories'),
  ('pricing.manage',      'Manage products and pricing plans platform-wide'),
  ('entitlements.manage', 'View and revoke entitlements'),
  ('entitlements.grant',  'Grant access (admin grants, promotions)'),
  ('moderation.manage',   'Hide or restore reviews'),
  ('payments.read',       'Read orders, refunds and earnings'),
  ('settings.manage',     'Change platform settings'),
  ('audit.read',          'Read audit logs and security events');

-- admin: everything except managing other admins (super_admin implicitly has all permissions)
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r cross join public.permissions p
where r.key = 'admin' and p.key <> 'admins.manage';

insert into public.platform_settings (key, value) values
  ('max_concurrent_streams',     '2'),
  ('sharing_ip_threshold',       '4'),
  ('sharing_block',              'false'),
  ('signed_url_ttl_seconds',     '900'),
  ('max_video_mb',               '1024'),
  ('max_video_minutes',          '240'),
  ('max_resource_mb',            '50'),
  ('instructor_storage_quota_mb','5120'),
  ('commission_percent',         '0');   -- reserved for phase 2
