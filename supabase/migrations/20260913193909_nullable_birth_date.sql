-- T-001 (seed-v2, AC-004) — 구글 OAuth로 처음 로그인하면 생년월일을 받을
-- 타이밍이 없다 (Supabase가 auth.users를 바로 만들어버림). 온보딩 화면에서
-- 나중에 채워지므로 이 컬럼은 더 이상 가입 시점 필수값이 아니다.
alter table public.users alter column birth_date drop not null;
