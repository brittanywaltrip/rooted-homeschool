-- ============================================================================
-- Rooted Homeschool: Mailbox Adventures
-- Three tables: public content, per-family progress, family-reported problems.
--
-- PRIVACY RULE (do not remove):
-- No table here stores a mailing address, a street, a city, a ZIP, or any
-- part of one. Families send their address directly to the organization,
-- never through Rooted. If a future change proposes an address column or an
-- "autofill my address" feature, that change is rejected. It would alter
-- Rooted's App Store data disclosure and its breach exposure.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. mailbox_listings  (public content, admin-managed)
-- ---------------------------------------------------------------------------
create table if not exists public.mailbox_listings (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  title               text not null,
  organization        text not null,

  category            text not null
                        check (category in ('50_states','national_parks','science_space',
                                            'nature_wildlife','history_government',
                                            'agriculture','money_business','around_the_world',
                                            'just_for_fun')),
  state_region        text,

  delivery_type       text not null
                        check (delivery_type in ('physical_mail','printable',
                                                 'physical_and_printable','local_loan')),

  -- reward_type is set only when a child earns something. It is deliberately
  -- separate from delivery_type: several NPS programs still mail an envelope
  -- but send a sticker or a paper badge instead of the real badge.
  reward_type         text
                        check (reward_type in ('badge','patch','sticker','paper_badge',
                                               'certificate')),
  is_earn_it          boolean not null default false,

  what_you_get        text not null,
  how_to_get_it       text,
  age_grade           text,
  subjects            text[] not null default '{}',

  is_rooted_pick      boolean not null default false,
  is_hidden_gem       boolean not null default false,

  delivery_time       text,   -- "2-3 weeks", shown so families know when to expect it
  supply_caveat       text,   -- "While supplies last"

  last_verified       date not null,
  verification_status text not null default 'verified'
                        check (verification_status in ('verified','needs_recheck','unavailable')),
  official_url        text not null,
  url_quality         text not null default 'direct_order_page'
                        check (url_quality in ('direct_order_page','general_page','likely_wrong_page')),

  -- Mirrors the existing public.resources link-checker columns so one checker
  -- can cover both tables. See the note in the CC prompt: the current checker
  -- reports "blocked" for sites that refuse automated requests, which is a
  -- false positive, not a dead link. Never hide a listing on this alone.
  last_check_status    text,
  consecutive_failures integer not null default 0,

  notes               text,
  is_active           boolean not null default true,
  sort_order          integer,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.mailbox_listings is
  'Curated free-by-mail educational resources. Official organizations only. Never stores user addresses.';
comment on column public.mailbox_listings.reward_type is
  'What the child actually receives. Kept separate from delivery_type so a sticker is never shown as a badge.';

create index if not exists mailbox_listings_category_idx    on public.mailbox_listings (category) where is_active;
create index if not exists mailbox_listings_state_idx       on public.mailbox_listings (state_region) where is_active;
create index if not exists mailbox_listings_earn_it_idx     on public.mailbox_listings (is_earn_it) where is_active;
create index if not exists mailbox_listings_subjects_idx    on public.mailbox_listings using gin (subjects);

alter table public.mailbox_listings enable row level security;

drop policy if exists "mailbox_listings are readable by everyone" on public.mailbox_listings;
create policy "mailbox_listings are readable by everyone"
  on public.mailbox_listings for select
  using (is_active = true);

grant select on public.mailbox_listings to anon;
grant select, insert, update, delete on public.mailbox_listings to authenticated;
grant select, insert, update, delete on public.mailbox_listings to service_role;


-- ---------------------------------------------------------------------------
-- 2. mailbox_progress  (per family, per child)
-- ---------------------------------------------------------------------------
create table if not exists public.mailbox_progress (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  child_id     uuid references public.children(id) on delete cascade,
  listing_id   uuid not null references public.mailbox_listings(id) on delete cascade,

  -- The only state Rooted keeps. No address, ever.
  requested_at timestamptz,
  received_at  timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (user_id, child_id, listing_id)
);

comment on table public.mailbox_progress is
  'Per-family request/received checkmarks. Deliberately holds no mailing address or any part of one.';

create index if not exists mailbox_progress_user_idx    on public.mailbox_progress (user_id);
create index if not exists mailbox_progress_listing_idx on public.mailbox_progress (listing_id);

alter table public.mailbox_progress enable row level security;

drop policy if exists "families read their own mailbox progress" on public.mailbox_progress;
create policy "families read their own mailbox progress"
  on public.mailbox_progress for select
  using (auth.uid() = user_id);

drop policy if exists "families insert their own mailbox progress" on public.mailbox_progress;
create policy "families insert their own mailbox progress"
  on public.mailbox_progress for insert
  with check (auth.uid() = user_id);

drop policy if exists "families update their own mailbox progress" on public.mailbox_progress;
create policy "families update their own mailbox progress"
  on public.mailbox_progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "families delete their own mailbox progress" on public.mailbox_progress;
create policy "families delete their own mailbox progress"
  on public.mailbox_progress for delete
  using (auth.uid() = user_id);

-- The anon SELECT grant follows the standing Rooted grant rule. It returns zero
-- rows: there is no policy for anon, and RLS denies by default.
grant select on public.mailbox_progress to anon;
grant select, insert, update, delete on public.mailbox_progress to authenticated;
grant select, insert, update, delete on public.mailbox_progress to service_role;


-- ---------------------------------------------------------------------------
-- 3. resource_reports  ("this link didn't work for us")
--
--    Covers BOTH resource tables: the existing public.resources (the curated
--    weekly picks, easy wins, discounts and so on) and the new
--    mailbox_listings. One report goes with exactly one item, enforced by the
--    check constraint below, so each side keeps a real foreign key and its own
--    cascade delete.
--
--    This is the maintenance escape hatch for the whole Resources page. The
--    automated link checker cannot be trusted on its own: government and
--    tourism sites routinely refuse automated requests and come back "blocked"
--    while working fine in a browser. A family telling you a link is dead is
--    the higher quality signal.
-- ---------------------------------------------------------------------------
create table if not exists public.resource_reports (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references auth.users(id) on delete set null,

  resource_id        uuid references public.resources(id) on delete cascade,
  mailbox_listing_id uuid references public.mailbox_listings(id) on delete cascade,

  reason             text not null
                       check (reason in ('link_broken','no_longer_free','never_arrived',
                                         'different_reward','not_as_described','other')),
  note               text,

  created_at         timestamptz not null default now(),
  resolved_at        timestamptz,
  resolution_note    text,

  constraint resource_reports_exactly_one_target check (
    (resource_id is not null and mailbox_listing_id is null)
    or
    (resource_id is null and mailbox_listing_id is not null)
  )
);

comment on table public.resource_reports is
  'Family-reported problems with any Resources item. Exactly one of resource_id or mailbox_listing_id is set.';

create index if not exists resource_reports_open_resource_idx
  on public.resource_reports (resource_id) where resolved_at is null;
create index if not exists resource_reports_open_mailbox_idx
  on public.resource_reports (mailbox_listing_id) where resolved_at is null;
create index if not exists resource_reports_open_recent_idx
  on public.resource_reports (created_at desc) where resolved_at is null;

alter table public.resource_reports enable row level security;

drop policy if exists "families read their own reports" on public.resource_reports;
create policy "families read their own reports"
  on public.resource_reports for select
  using (auth.uid() = user_id);

drop policy if exists "families file their own reports" on public.resource_reports;
create policy "families file their own reports"
  on public.resource_reports for insert
  with check (auth.uid() = user_id);

grant select on public.resource_reports to anon;
grant select, insert, update, delete on public.resource_reports to authenticated;
grant select, insert, update, delete on public.resource_reports to service_role;


-- ---------------------------------------------------------------------------
-- 4. updated_at triggers
--
-- public.set_updated_at() ALREADY EXISTS in this project and is already used by
-- child_ui_prefs and daily_reflections. It is defined with SET search_path TO
-- 'public', which satisfies the Supabase security advisor.
--
-- DO NOT create or replace it here. A CREATE OR REPLACE without that SET clause
-- would silently strip the search_path from the live function, changing behavior
-- for both existing tables and raising a new advisor warning. Reuse it as-is.
-- ---------------------------------------------------------------------------

drop trigger if exists mailbox_listings_updated_at on public.mailbox_listings;
create trigger mailbox_listings_updated_at
  before update on public.mailbox_listings
  for each row execute function public.set_updated_at();

drop trigger if exists mailbox_progress_updated_at on public.mailbox_progress;
create trigger mailbox_progress_updated_at
  before update on public.mailbox_progress
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Seed the 119 verified listings.
--    Idempotent: re-running updates existing rows by slug, never duplicates.
-- ---------------------------------------------------------------------------
insert into public.mailbox_listings
  (slug, title, organization, category, state_region, delivery_type, reward_type, is_earn_it, what_you_get, how_to_get_it, age_grade, subjects, is_rooted_pick, is_hidden_gem, delivery_time, supply_caveat, last_verified, verification_status, official_url, url_quality, notes, sort_order)
values
  ('alabama-vacation-events-guide', 'Alabama Vacation & Events Guide', 'Alabama Tourism Department', '50_states', 'Alabama', 'physical_mail', null, false, 'Printed state vacation guide', 'Submit mailing form', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://alabama.travel/vacation-guide', 'direct_order_page', 'Official page says a printed guide is mailed within the U.S.', 1),
  ('alabama-official-highway-map', 'Alabama Official Highway Map', 'Alabama Tourism Department', '50_states', 'Alabama', 'physical_mail', null, false, 'Official state highway map', 'Select highway map on guide form', 'All ages', '{"Geography","Map Skills"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://alabama.travel/vacation-guide', 'direct_order_page', 'Can be selected with the guide.', 2),
  ('alaska-state-vacation-planner', 'Alaska State Vacation Planner', 'Travel Alaska', '50_states', 'Alaska', 'physical_mail', null, false, 'Official State of Alaska vacation planner', 'Submit mailing form', 'All ages', '{"Geography","State Studies","Nature"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://www.travelalaska.com/plan-your-trip/planning-tools/vacation-planner', 'direct_order_page', 'Official print-by-mail option for U.S. addresses.', 3),
  ('arizona-travel-guide-state-map', 'Arizona Travel Guide + State Map', 'Visit Arizona', '50_states', 'Arizona', 'physical_mail', null, false, 'Travel guide + full-size state map', 'Create order on official form', 'All ages', '{"Geography","Map Skills","State Studies"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.visitarizona.com/plan/travel-guide', 'direct_order_page', 'Official page says packet includes guide and full-sized map.', 4),
  ('arizona-parks-passport-card', 'Arizona Parks Passport Card', 'Visit Arizona', '50_states', 'Arizona', 'physical_mail', null, false, 'Travel guide + state map + parks passport card', 'Choose parks passport option', 'All ages', '{"Geography","Parks","Travel"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.visitarizona.com/plan/travel-guide', 'direct_order_page', 'Optional packet variation.', 5),
  ('arkansas-travel-guide', 'Arkansas Travel Guide', 'Arkansas Tourism', '50_states', 'Arkansas', 'physical_mail', null, false, 'Printed Arkansas Travel Guide', 'Add publication and submit form', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://www.arkansas.com/plan-your-trip/plan/guides-maps', 'direct_order_page', 'An Arkansas map is included with every guide.', 6),
  ('arkansas-state-map', 'Arkansas State Map', 'Arkansas Tourism', '50_states', 'Arkansas', 'physical_mail', null, false, 'Arkansas map included with guide', 'Order a guide', 'All ages', '{"Geography","Map Skills"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.arkansas.com/plan-your-trip/plan/guides-maps', 'direct_order_page', 'Map included with every guide.', 7),
  ('arkansas-state-parks-guide', 'Arkansas State Parks Guide', 'Arkansas Tourism', '50_states', 'Arkansas', 'physical_mail', null, false, 'Arkansas State Parks guide', 'Add publication and submit form', 'All ages', '{"Geography","Nature","State Parks"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.arkansas.com/publications/vacation-kit/order-confirmation', 'direct_order_page', 'Official ordering page lists State Parks Guide.', 8),
  ('california-visitor-s-guide', 'California Visitor''s Guide', 'State of California', '50_states', 'California', 'physical_mail', null, false, 'Free California visitor''s guide', 'Order through state service', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://www.ca.gov/topics/recreation/', 'general_page', 'State page links to free visitor''s guide ordering.', 9),
  ('colorado-2026-official-state-vacation-guide', 'Colorado 2026 Official State Vacation Guide', 'Colorado Tourism Office', '50_states', 'Colorado', 'physical_mail', null, false, 'Printed state vacation guide', 'Submit visitor guide request', 'All ages', '{"Geography","State Studies","Nature"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://www.colorado.com/guide-order', 'direct_order_page', 'Official free print guide.', 10),
  ('delaware-travel-guide', 'Delaware Travel Guide', 'Delaware Tourism Office', '50_states', 'Delaware', 'physical_mail', null, false, 'Printed Delaware Travel Guide', 'Submit mailing form', 'All ages', '{"Geography","State Studies"}'::text[], false, false, null, null, '2026-08-31', 'verified', 'https://www.visitdelaware.com/visitors-guide/', 'direct_order_page', 'Official mailing form.', 11),
  ('florida-official-vacation-guide', 'Florida Official Vacation Guide', 'VISIT FLORIDA', '50_states', 'Florida', 'physical_mail', null, false, 'Printed official vacation guide', 'Use U.S. printed-guide order form', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://www.visitflorida.com/more/travel-guides/print-guides/', 'direct_order_page', 'Print guides available by mail for U.S. addresses.', 12),
  ('georgia-travel-guide', 'Georgia Travel Guide', 'Explore Georgia', '50_states', 'Georgia', 'physical_mail', null, false, '2026 Official State Travel Guide', 'Order official guide', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://exploregeorgia.org/plan-your-trip', 'direct_order_page', 'Official site offers free mailed travel guide.', 13),
  ('georgia-state-map', 'Georgia State Map', 'Explore Georgia', '50_states', 'Georgia', 'physical_mail', null, false, 'Georgia state map', 'Order with trip-planning resources', 'All ages', '{"Geography","Map Skills"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://exploregeorgia.org/plan-your-trip', 'direct_order_page', 'Official trip-planning page says order guide and state map.', 14),
  ('idaho-official-travel-guide', 'Idaho Official Travel Guide', 'Visit Idaho', '50_states', 'Idaho', 'physical_mail', null, false, '2026 Official Idaho Travel Guide', 'Order printed guide', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://visitidaho.org/order-maps-publications-by-mail/', 'direct_order_page', '2026 guide available at no cost in print.', 15),
  ('iowa-2026-travel-guide', 'Iowa 2026 Travel Guide', 'Travel Iowa', '50_states', 'Iowa', 'physical_mail', null, false, '2026 Iowa Travel Guide', 'Select guide on order form', 'All ages', '{"Geography","State Studies"}'::text[], true, false, '2-3 weeks', null, '2026-08-31', 'verified', 'https://www.traveliowa.com/order/orderform/', 'direct_order_page', 'Delivery stated as 2-3 weeks.', 16),
  ('iowa-transportation-map', 'Iowa Transportation Map', 'Travel Iowa', '50_states', 'Iowa', 'physical_mail', null, false, '2025-2026 Iowa transportation map', 'Select map on order form', 'All ages', '{"Geography","Map Skills"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.traveliowa.com/order/orderform/', 'direct_order_page', 'Can be selected separately or with guide.', 17),
  ('kansas-travel-guide-road-map', 'Kansas Travel Guide & Road Map', 'Kansas Tourism', '50_states', 'Kansas', 'physical_mail', null, false, 'Travel guide + official road map', 'Select Travel Guide & Road Map', 'All ages', '{"Geography","Map Skills","State Studies"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.travelks.com/plan-your-trip/free-travel-guide-and-map/', 'direct_order_page', 'Official free order form.', 18),
  ('kansas-byway-guide', 'Kansas Byway Guide', 'Kansas Tourism', '50_states', 'Kansas', 'physical_mail', null, false, 'Kansas Byway Guide', 'Select Byway Guide', 'All ages', '{"Geography","Road Trips","History"}'::text[], false, true, null, null, '2026-08-31', 'verified', 'https://www.travelks.com/plan-your-trip/free-travel-guide-and-map/', 'direct_order_page', 'Listed on official order form.', 19),
  ('kansas-outdoor-packet', 'Kansas Outdoor Packet', 'Kansas Tourism', '50_states', 'Kansas', 'physical_mail', null, false, 'Outdoor packet', 'Use Kansas travel-info ordering resources', 'All ages', '{"Nature","Geography","Outdoor Education"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.travelks.com/plan-your-trip/travel-info/', 'direct_order_page', 'Official page advertises free Outdoor Packet.', 20),
  ('louisiana-official-travel-guide', 'Louisiana Official Travel Guide', 'Explore Louisiana', '50_states', 'Louisiana', 'physical_mail', null, false, '2026 Louisiana Official Travel Guide', 'Submit mailing form', 'All ages', '{"Geography","State Studies"}'::text[], false, false, null, null, '2026-08-31', 'needs_recheck', 'https://www.povertypoint.us/guide-order', 'likely_wrong_page', 'Official free mailed guide for U.S., Canada, Mexico.', 21),
  ('maine-official-travel-planner-adventure-guide', 'Maine Official Travel Planner & Adventure Guide', 'Maine Office of Tourism', '50_states', 'Maine', 'physical_mail', null, false, '2026 travel planner + map of Maine', 'Submit order form', 'All ages', '{"Geography","Map Skills","Nature"}'::text[], true, false, '2-3 weeks', null, '2026-08-31', 'verified', 'https://www.mainetravelguidebook.com/', 'general_page', 'Printed guide, includes map; 2-3 week delivery noted.', 22),
  ('maryland-destination-maryland-travel-guide', 'Maryland Destination Maryland Travel Guide', 'Maryland Office of Tourism Development', '50_states', 'Maryland', 'physical_mail', null, false, 'Destination Maryland Travel Guide', 'Use Mail Order Guide link', 'All ages', '{"Geography","State Studies"}'::text[], false, false, null, null, '2026-08-31', 'verified', 'https://www.visitmaryland.org/form/contact-us', 'general_page', 'Official tourism page provides mail-order guide link.', 23),
  ('massachusetts-travel-guide', 'Massachusetts Travel Guide', 'Massachusetts Office of Travel and Tourism', '50_states', 'Massachusetts', 'physical_mail', null, false, 'Massachusetts Travel Guide', 'Select publication and submit', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://www.visitma.com/get-a-massachusetts-travel-guide/', 'direct_order_page', 'Official free mailing form.', 24),
  ('massachusetts-highway-map', 'Massachusetts Highway Map', 'Massachusetts Office of Travel and Tourism', '50_states', 'Massachusetts', 'physical_mail', null, false, 'Massachusetts Highway Map', 'Select map or both', 'All ages', '{"Geography","Map Skills"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.visitma.com/get-a-massachusetts-travel-guide/', 'direct_order_page', 'Can order guide, map, or both.', 25),
  ('michigan-pure-michigan-travel-guide', 'Michigan Pure Michigan Travel Guide', 'Pure Michigan', '50_states', 'Michigan', 'physical_mail', null, false, '2026 Pure Michigan travel guide', 'Submit guide order', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://www.michigan.org/travel-guide', 'direct_order_page', 'Free print guide.', 26),
  ('michigan-state-map', 'Michigan State Map', 'Pure Michigan', '50_states', 'Michigan', 'physical_mail', null, false, 'Complimentary State of Michigan map', 'Use map order link from travel-guide page', 'All ages', '{"Geography","Map Skills"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.michigan.org/travel-guide', 'direct_order_page', 'Official page specifically offers complimentary state map.', 27),
  ('michigan-kid-friendly-school-project-resources', 'Michigan Kid-Friendly School Project Resources', 'Pure Michigan', '50_states', 'Michigan', 'printable', null, false, 'Kid-friendly Michigan school-project resources', 'Open kid-friendly resources link', 'School age', '{"State Studies","Geography","History"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.michigan.org/travel-guide', 'direct_order_page', 'Official page points school projects to kid-friendly resources.', 28),
  ('minnesota-2026-travel-guide', 'Minnesota 2026 Travel Guide', 'Explore Minnesota', '50_states', 'Minnesota', 'physical_mail', null, false, '2026 Minnesota Travel Guide', 'Check mail option and submit form', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://www.exploreminnesota.com/travel-guide', 'direct_order_page', 'U.S./Canada delivery.', 29),
  ('minnesota-all-about-minnesota-student-guide', 'Minnesota ''All About Minnesota'' Student Guide', 'Explore Minnesota', '50_states', 'Minnesota', 'printable', null, false, 'Student guide focused on Minnesota', 'Download student guide', 'School age', '{"State Studies","Geography"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.exploreminnesota.com/travel-guide', 'direct_order_page', 'Not currently shown as mailed; excellent homeschool printable.', 30),
  ('missouri-2026-travel-guide', 'Missouri 2026 Travel Guide', 'Missouri Division of Tourism', '50_states', 'Missouri', 'physical_mail', null, false, '2026 Official Missouri Travel Guide', 'Submit mailing form', 'All ages', '{"Geography","State Studies"}'::text[], false, false, null, null, '2026-08-31', 'verified', 'https://www.visitmo.com/travel-guide', 'direct_order_page', 'Complimentary mailed guide.', 31),
  ('nebraska-2026-travel-guide', 'Nebraska 2026 Travel Guide', 'Nebraska Tourism Commission', '50_states', 'Nebraska', 'physical_mail', null, false, '2026 Nebraska State Travel Guide', 'Submit request form', 'All ages', '{"Geography","State Studies","History"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://nebraskapassport.com/request-travel-guide', 'direct_order_page', 'Official free printed guide.', 32),
  ('nevada-magazine-visitor-guide', 'Nevada Magazine & Visitor Guide', 'Travel Nevada', '50_states', 'Nevada', 'physical_mail', null, false, 'Biannual Nevada Magazine & Visitor Guide', 'Sign up for mailbox delivery', 'All ages', '{"Geography","State Studies","Nevada History"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://travelnevada.com/travel-guides/', 'direct_order_page', 'Delivered free to mailbox every six months.', 33),
  ('new-jersey-travel-guide', 'New Jersey Travel Guide', 'New Jersey Division of Travel & Tourism', '50_states', 'New Jersey', 'physical_mail', null, false, 'Official NJ Travel Guide', 'Request mailed copy', 'All ages', '{"Geography","State Studies"}'::text[], false, false, null, null, '2026-08-31', 'verified', 'https://visitnj.org/form/request-or-download-free-travel-guides', 'direct_order_page', 'Official free mailed guide.', 34),
  ('new-jersey-fun-and-facts-guide', 'New Jersey Fun and Facts Guide', 'New Jersey Division of Travel & Tourism', '50_states', 'New Jersey', 'printable', null, false, 'NJ Fun and Facts Guide', 'Download PDF', 'School age', '{"State Studies","Geography","History"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://visitnj.org/form/request-or-download-free-travel-guides', 'direct_order_page', 'Especially kid-friendly companion resource.', 35),
  ('new-jersey-history-guide', 'New Jersey History Guide', 'New Jersey Division of Travel & Tourism', '50_states', 'New Jersey', 'printable', null, false, 'New Jersey History Guide', 'Download PDF', 'School age+', '{"History","State Studies"}'::text[], false, true, null, null, '2026-08-31', 'verified', 'https://visitnj.org/form/request-or-download-free-travel-guides', 'direct_order_page', 'Useful for state-history unit.', 36),
  ('new-jersey-lighthouse-guide', 'New Jersey Lighthouse Guide', 'New Jersey Division of Travel & Tourism', '50_states', 'New Jersey', 'printable', null, false, 'Lighthouse guide', 'Download PDF', 'School age+', '{"History","Geography","Maritime"}'::text[], false, true, null, null, '2026-08-31', 'verified', 'https://visitnj.org/form/request-or-download-free-travel-guides', 'direct_order_page', 'Good themed extension.', 37),
  ('new-york-i-love-ny-travel-planner', 'New York I LOVE NY Travel Planner', 'I LOVE NY', '50_states', 'New York', 'physical_mail', null, false, 'I LOVE NY Travel Planner', 'Select brochure and submit mailing info', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://www.iloveny.com/travel-tools/guides/', 'direct_order_page', 'U.S./Canada mail.', 38),
  ('new-york-state-map', 'New York State Map', 'I LOVE NY', '50_states', 'New York', 'physical_mail', null, false, 'NYS Map', 'Select NYS Map on brochure form', 'All ages', '{"Geography","Map Skills"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.iloveny.com/travel-tools/guides/', 'direct_order_page', 'Mailed brochure option.', 39),
  ('i-love-ny-kids-guide', 'I LOVE NY Kids Guide', 'I LOVE NY', '50_states', 'New York', 'physical_mail', null, false, 'Kids Guide', 'Select Kids Guide', 'School age', '{"State Studies","Geography","Family Learning"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.iloveny.com/travel-tools/guides/', 'direct_order_page', 'One of the strongest kid-specific state finds.', 40),
  ('i-love-ny-path-through-history-guide', 'I LOVE NY Path Through History Guide', 'I LOVE NY', '50_states', 'New York', 'physical_mail', null, false, 'Path Through History Guide', 'Select brochure', 'School age+', '{"History","State Studies"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.iloveny.com/travel-tools/guides/', 'direct_order_page', 'Mailed brochure option.', 41),
  ('i-love-ny-black-travel-guide', 'I LOVE NY Black Travel Guide', 'I LOVE NY', '50_states', 'New York', 'physical_mail', null, false, 'Black Travel Guide', 'Select brochure', 'School age+', '{"History","Culture","State Studies"}'::text[], false, true, null, null, '2026-08-31', 'verified', 'https://www.iloveny.com/travel-tools/guides/', 'direct_order_page', 'Mailed brochure option.', 42),
  ('north-carolina-2026-travel-guide', 'North Carolina 2026 Travel Guide', 'Visit North Carolina', '50_states', 'North Carolina', 'physical_mail', null, false, '2026 Travel Guide', 'Select guide on official order form', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://www.visitnc.com/travel-guides', 'direct_order_page', 'Official guide ordering page.', 43),
  ('north-carolina-highway-map', 'North Carolina Highway Map', 'Visit North Carolina', '50_states', 'North Carolina', 'physical_mail', null, false, 'Official highway map', 'Select Highway Map', 'All ages', '{"Geography","Map Skills"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.visitnc.com/travel-guides', 'direct_order_page', 'Official order form includes highway map.', 44),
  ('north-carolina-civil-war-trails-map', 'North Carolina Civil War Trails Map', 'Visit North Carolina', '50_states', 'North Carolina', 'physical_and_printable', null, false, 'Civil War Trails map and guide', 'Select/download from guide page', 'School age+', '{"History","Geography"}'::text[], false, true, null, null, '2026-08-31', 'verified', 'https://www.visitnc.com/travel-guides', 'direct_order_page', 'Availability may be print or digital depending form behavior.', 45),
  ('north-dakota-travel-guide-kit', 'North Dakota Travel Guide Kit', 'North Dakota Tourism', '50_states', 'North Dakota', 'physical_mail', null, false, '2026 Travel Guide + Highway Map', 'Add Travel Guide Kit to cart', 'All ages', '{"Geography","State Studies","Map Skills"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.ndtourism.com/visitor-information-order-form', 'direct_order_page', 'Ships to U.S. and Canada.', 46),
  ('north-dakota-map', 'North Dakota Map', 'North Dakota Tourism', '50_states', 'North Dakota', 'physical_mail', null, false, 'Highway map only', 'Add North Dakota Map', 'All ages', '{"Geography","Map Skills"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.ndtourism.com/visitor-information-order-form', 'direct_order_page', 'Can order map separately.', 47),
  ('north-dakota-hunting-fishing-kit', 'North Dakota Hunting & Fishing Kit', 'North Dakota Tourism', '50_states', 'North Dakota', 'physical_mail', null, false, 'Hunting & Fishing Guide + Travel Guide + Highway Map', 'Add kit', 'School age+', '{"Wildlife","Geography","Outdoor Education"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.ndtourism.com/visitor-information-order-form', 'direct_order_page', 'Strong nature/outdoors packet.', 48),
  ('north-dakota-student-education-resources', 'North Dakota Student Education Resources', 'North Dakota Tourism', '50_states', 'North Dakota', 'printable', null, false, 'Student education + coloring map', 'Use Maps & Guides student section', 'School age', '{"State Studies","Geography"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.ndtourism.com/maps-guides', 'direct_order_page', 'Official page includes Student Education and ND Coloring Map.', 49),
  ('oregon-visitor-guide', 'Oregon Visitor Guide', 'Travel Oregon', '50_states', 'Oregon', 'physical_mail', null, false, 'Travel Oregon Visitor Guide', 'Order free guides/maps', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://traveloregon.com/', 'general_page', 'Official site advertises free mailed guide.', 50),
  ('oregon-guide-to-indian-country', 'Oregon Guide to Indian Country', 'Travel Oregon', '50_states', 'Oregon', 'physical_mail', null, false, 'Oregon Guide to Indian Country', 'Order free guides/maps', 'School age+', '{"History","Culture","Geography"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://traveloregon.com/', 'general_page', 'Official free mail offering.', 51),
  ('oregon-scenic-byways-guide', 'Oregon Scenic Byways Guide', 'Travel Oregon', '50_states', 'Oregon', 'physical_mail', null, false, 'Scenic Byways Guide', 'Order free guides/maps', 'All ages', '{"Geography","Map Skills"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://traveloregon.com/', 'general_page', 'Official free mail offering.', 52),
  ('official-oregon-state-map', 'Official Oregon State Map', 'Travel Oregon', '50_states', 'Oregon', 'physical_mail', null, false, 'Official Oregon State Map', 'Order free guides/maps', 'All ages', '{"Geography","Map Skills"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://traveloregon.com/', 'general_page', 'Official free mail offering.', 53),
  ('pennsylvania-2026-travel-guide', 'Pennsylvania 2026 Travel Guide', 'Visit PA', '50_states', 'Pennsylvania', 'physical_mail', null, false, '2026 Pennsylvania Travel Guide', 'Submit request form', 'All ages', '{"Geography","State Studies"}'::text[], false, false, null, null, '2026-08-31', 'verified', 'https://www.visitpa.com/free-traveler-guide/', 'direct_order_page', 'Official free printed copy.', 54),
  ('rhode-island-travel-guide', 'Rhode Island Travel Guide', 'Rhode Island Commerce', '50_states', 'Rhode Island', 'physical_mail', null, false, 'Official Rhode Island Travel Guide', 'Submit travel guide request', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://www.visitrhodeisland.com/plan/travel-guide-ihrtamzn/', 'direct_order_page', 'Official page offers free physical copy.', 55),
  ('south-carolina-2026-vacation-guide', 'South Carolina 2026 Vacation Guide', 'South Carolina PRT', '50_states', 'South Carolina', 'physical_mail', null, false, '2026 Vacation Guide', 'Request by mail', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://discoversouthcarolina.com/vacation-guides', 'direct_order_page', 'Official free mail guide.', 56),
  ('south-carolina-state-parks-guide', 'South Carolina State Parks Guide', 'South Carolina PRT', '50_states', 'South Carolina', 'physical_mail', null, false, 'SC Parks Guide', 'Order a guide', 'All ages', '{"Nature","Geography","State Parks"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://discoversouthcarolina.com/vacation-guides', 'direct_order_page', 'Separate mail-order parks guide.', 57),
  ('south-dakota-vacation-guide', 'South Dakota Vacation Guide', 'Travel South Dakota', '50_states', 'South Dakota', 'physical_mail', null, false, 'Free South Dakota travel guide', 'Request guide packet', 'All ages', '{"Geography","State Studies"}'::text[], true, false, '2-3 weeks', null, '2026-08-31', 'verified', 'https://www.travelsouthdakota.com/request-free-vacation-guide', 'direct_order_page', '2-3 week delivery stated.', 58),
  ('tennessee-2026-vacation-guide', 'Tennessee 2026 Vacation Guide', 'Tennessee Department of Tourist Development', '50_states', 'Tennessee', 'physical_mail', null, false, '2026 Tennessee Vacation Guide', 'Submit printed-guide form', 'All ages', '{"Geography","State Studies"}'::text[], true, false, '4-6 weeks', null, '2026-08-31', 'verified', 'https://www.tnvacation.com/guide', 'direct_order_page', '4-6 week delivery stated.', 59),
  ('tennessee-playcation-kid-s-guide', 'Tennessee Playcation Kid''s Guide', 'Tennessee Department of Tourist Development', '50_states', 'Tennessee', 'printable', null, false, 'Free family/kids guide', 'Open kid''s guide', 'Kids', '{"State Studies","Family Learning","Geography"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.tnvacation.com/guide', 'direct_order_page', 'Official page calls it totally free.', 60),
  ('texas-2026-state-travel-guide', 'Texas 2026 State Travel Guide', 'Texas Department of Transportation', '50_states', 'Texas', 'physical_mail', null, false, '2026 Texas State Travel Guide', 'Submit official guide form', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://www.traveltexas.com/plan-ahead/travel-guide/', 'direct_order_page', 'Official free printed guide.', 61),
  ('official-texas-travel-map', 'Official Texas Travel Map', 'Texas Department of Transportation', '50_states', 'Texas', 'physical_mail', null, false, 'Official Texas Travel Map', 'Order while supplies last', 'All ages', '{"Geography","Map Skills"}'::text[], true, true, null, 'While supplies last', '2026-08-31', 'verified', 'https://www.txdot.gov/about/newsroom/stories/get-your-kicks-with-the-2026-texas-travel-guide.html', 'direct_order_page', 'TxDOT says free printed copies while supplies last.', 62),
  ('utah-travel-guide', 'Utah Travel Guide', 'Utah Office of Tourism', '50_states', 'Utah', 'physical_mail', null, false, 'Official Utah Travel Guide', 'Select on request form', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://www.visitutah.com/plan-your-trip/utah-travel-guide', 'direct_order_page', 'U.S./Canada addresses.', 63),
  ('utah-highway-map', 'Utah Highway Map', 'Utah Office of Tourism', '50_states', 'Utah', 'physical_mail', null, false, 'Utah Highway Map', 'Select highway map', 'All ages', '{"Geography","Map Skills"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.visitutah.com/plan-your-trip/utah-travel-guide', 'direct_order_page', 'Can be mailed with guide.', 64),
  ('utah-national-parks-brochure', 'Utah National Parks Brochure', 'Utah Office of Tourism', '50_states', 'Utah', 'physical_mail', null, false, 'National Parks brochure', 'Select national parks brochure', 'All ages', '{"National Parks","Geography","Nature"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.visitutah.com/plan-your-trip/utah-travel-guide', 'direct_order_page', 'Excellent homeschool add-on.', 65),
  ('virginia-2026-travel-guide-state-map', 'Virginia 2026 Travel Guide + State Map', 'Virginia Tourism Corporation', '50_states', 'Virginia', 'physical_mail', null, false, 'Travel Guide and State Map', 'Select combo and submit', 'All ages', '{"Geography","State Studies","Map Skills"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.virginia.org/plan-your-trip/virginia-travel-guide/', 'direct_order_page', 'Official free guide/map combo.', 66),
  ('virginia-civil-war-trails-map-guide', 'Virginia Civil War Trails Map & Guide', 'Virginia Tourism Corporation', '50_states', 'Virginia', 'physical_mail', null, false, 'Civil War Trails map and guide', 'Select on mailing form', 'School age+', '{"History","Geography"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.virginia.org/plan-your-trip/virginia-travel-guide/', 'direct_order_page', 'Separate selectable publication.', 67),
  ('virginia-campground-directory', 'Virginia Campground Directory', 'Virginia Tourism Corporation', '50_states', 'Virginia', 'physical_mail', null, false, 'Campground directory', 'Select on mailing form', 'All ages', '{"Geography","Outdoor Education"}'::text[], false, true, null, null, '2026-08-31', 'verified', 'https://www.virginia.org/plan-your-trip/virginia-travel-guide/', 'direct_order_page', 'Separate selectable publication.', 68),
  ('west-virginia-vacation-guide', 'West Virginia Vacation Guide', 'West Virginia Department of Tourism', '50_states', 'West Virginia', 'physical_mail', null, false, 'West Virginia Vacation Guide', 'Order online', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://wvtourism.com/information-and-press/faq/', 'general_page', 'Official FAQ confirms free guide.', 69),
  ('west-virginia-highway-map', 'West Virginia Highway Map', 'West Virginia Department of Tourism', '50_states', 'West Virginia', 'physical_mail', null, false, 'West Virginia highway map', 'Call 1-800-CALL-WVA', 'All ages', '{"Geography","Map Skills"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://wvtourism.com/information-and-press/faq/', 'general_page', 'Official FAQ says highway maps can be ordered by phone.', 70),
  ('wisconsin-official-travel-guide', 'Wisconsin Official Travel Guide', 'Travel Wisconsin', '50_states', 'Wisconsin', 'physical_mail', null, false, 'Official Wisconsin Travel Guide', 'Add guide and submit shipping form', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://www.travelwisconsin.com/order-guides', 'direct_order_page', 'Free U.S. mailing.', 71),
  ('wisconsin-official-state-highway-map', 'Wisconsin Official State Highway Map', 'Travel Wisconsin', '50_states', 'Wisconsin', 'physical_mail', null, false, 'Official highway map', 'Add map', 'All ages', '{"Geography","Map Skills"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.travelwisconsin.com/order-guides', 'direct_order_page', 'Free U.S. mailing.', 72),
  ('wisconsin-rustic-roads-guide', 'Wisconsin Rustic Roads Guide', 'Travel Wisconsin', '50_states', 'Wisconsin', 'physical_mail', null, false, '2026 Rustic Roads', 'Add publication', 'All ages', '{"Geography","Road Trips"}'::text[], false, true, null, null, '2026-08-31', 'verified', 'https://www.travelwisconsin.com/order-guides', 'direct_order_page', 'Free U.S. mailing.', 73),
  ('native-american-wisconsin-guide', 'Native American Wisconsin Guide', 'Travel Wisconsin', '50_states', 'Wisconsin', 'physical_mail', null, false, 'Native American Wisconsin Guide', 'Add publication', 'School age+', '{"History","Culture","Geography"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.travelwisconsin.com/order-guides', 'direct_order_page', 'Free U.S. mailing.', 74),
  ('wisconsin-campground-directory', 'Wisconsin Campground Directory', 'Travel Wisconsin', '50_states', 'Wisconsin', 'physical_mail', null, false, '2026 Campground Directory', 'Add publication', 'All ages', '{"Nature","Geography"}'::text[], false, true, null, null, '2026-08-31', 'verified', 'https://www.travelwisconsin.com/order-guides', 'direct_order_page', 'Free U.S. mailing.', 75),
  ('wyoming-2026-official-travel-guide', 'Wyoming 2026 Official Travel Guide', 'Wyoming Office of Tourism', '50_states', 'Wyoming', 'physical_mail', null, false, '2026 Wyoming Official Travel Guide', 'Submit guide form', 'All ages', '{"Geography","State Studies"}'::text[], true, false, null, null, '2026-08-31', 'verified', 'https://travelwyoming.com/plan-your-trip/resources/travel-guide/', 'direct_order_page', 'Official free guide.', 76),
  ('badlands-virtual-junior-ranger-patch', 'Badlands Virtual Junior Ranger Patch', 'National Park Service', 'national_parks', 'South Dakota', 'physical_mail', 'patch', true, 'Official patch', 'Complete virtual adventure and email as instructed', 'Kids / families', '{"Geology","Nature","National Parks"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/thingstodo/junior-ranger-booklet-badl.htm', 'direct_order_page', 'Official page updated Aug. 20, 2026 says receive official patch in mail.', 77),
  ('badlands-junior-ranger-badge-certificate', 'Badlands Junior Ranger Badge + Certificate', 'National Park Service', 'national_parks', 'South Dakota', 'physical_mail', 'badge', true, 'Badge + signed certificate', 'Complete booklet and mail it back', 'Ages 5-12+', '{"Geology","Nature","National Parks"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/thingstodo/junior-ranger-booklet-badl.htm', 'direct_order_page', 'Park mails booklet back with badge and certificate.', 78),
  ('captain-john-smith-chesapeake-junior-ranger', 'Captain John Smith Chesapeake Junior Ranger', 'National Park Service', 'national_parks', 'Virginia', 'physical_mail', 'badge', true, 'Junior Ranger badge', 'Email completed booklet + mailing address', 'Kids / families', '{"History","Geography","National Parks"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/cajo/learn/kidsyouth/junior-ranger.htm', 'direct_order_page', 'Official page says check mailbox for badge.', 79),
  ('minidoka-junior-ranger', 'Minidoka Junior Ranger', 'National Park Service', 'national_parks', 'Idaho', 'physical_mail', 'badge', true, 'Junior Ranger badge', 'Mail or email completed booklet', 'Kids / families', '{"U.S. History","Civics","National Parks"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/miin/learn/kidsyouth/beajuniorranger.htm', 'direct_order_page', 'Updated June 10, 2026.', 80),
  ('bainbridge-island-junior-ranger', 'Bainbridge Island Junior Ranger', 'National Park Service', 'national_parks', 'Washington', 'physical_mail', 'badge', true, 'Junior Ranger badge', 'Mail or email completed booklet', 'Kids / families', '{"U.S. History","Civics","National Parks"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/miin/learn/kidsyouth/beajuniorranger.htm', 'direct_order_page', 'Badge mailed by Klondike Gold Rush NHP Seattle office.', 81),
  ('santa-fe-trail-junior-ranger', 'Santa Fe Trail Junior Ranger', 'National Park Service', 'national_parks', 'Multi-state', 'physical_mail', 'badge', true, 'Exclusive Junior Ranger badge', 'Email worksheet + name/address or mail it', 'Kids / families', '{"U.S. History","Geography","Westward Expansion"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/safe/learn/kidsyouth/junior-ranger.htm', 'direct_order_page', 'Can be completed virtually.', 82),
  ('san-antonio-missions-junior-ranger', 'San Antonio Missions Junior Ranger', 'National Park Service', 'national_parks', 'Texas', 'physical_mail', 'badge', true, 'Junior Ranger badge', 'Email photo of completed activity + address', 'Any age', '{"History","Culture","National Parks"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://home.nps.gov/saan/learn/kidsyouth/junior-ranger.htm', 'direct_order_page', 'Official page gives at-home mail instructions.', 83),
  ('little-rock-central-high-school-junior-ranger', 'Little Rock Central High School Junior Ranger', 'National Park Service', 'national_parks', 'Arkansas', 'physical_mail', 'badge', true, 'Booklet returned + Junior Ranger badge', 'Request/download booklet, complete, email or mail', 'Elementary through adult', '{"Civil Rights","U.S. History","Civics"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://home.nps.gov/chsc/learn/kidsyouth/junior-ranger.htm', 'direct_order_page', 'Can request a mailed booklet too; updated Feb. 9, 2026.', 84),
  ('trail-of-tears-junior-ranger', 'Trail of Tears Junior Ranger', 'National Park Service', 'national_parks', 'Multi-state', 'physical_mail', 'badge', true, 'Exclusive Junior Ranger badge', 'Email photo of completed worksheet + address', 'Kids / families', '{"Native American History","U.S. History","Geography"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/thingstodo/become-a-trail-of-tears-junior-ranger.htm', 'direct_order_page', 'Can complete virtually.', 85),
  ('yosemite-virtual-junior-ranger', 'Yosemite Virtual Junior Ranger', 'National Park Service', 'national_parks', 'California', 'physical_mail', 'badge', true, 'Virtual Junior Ranger badge', 'Complete worksheets and email/mail', 'Kids / families', '{"Nature","Ecology","National Parks"}'::text[], true, true, '6-8 weeks', 'Limited number available', '2026-08-31', 'verified', 'https://home.nps.gov/yose/learn/kidsyouth/junior-ranger.htm', 'direct_order_page', 'Limited number; U.S. only; 6-8 weeks stated.', 86),
  ('zion-junior-ranger-badge-by-mail', 'Zion Junior Ranger Badge by Mail', 'National Park Service', 'national_parks', 'Utah', 'physical_mail', 'badge', true, 'Junior Ranger badge', 'Email photos of completed activity pages + address', 'Ages 4+', '{"Geology","Nature","National Parks"}'::text[], false, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/zion/learn/kidsyouth/beajuniorranger.htm', 'direct_order_page', 'Updated July 4, 2026; framed as if visitor couldn''t get badge before leaving.', 87),
  ('obed-junior-ranger-badge-by-mail', 'Obed Junior Ranger Badge by Mail', 'National Park Service', 'national_parks', 'Tennessee', 'physical_mail', 'badge', true, 'Junior Ranger badge', 'Mail completed booklet', 'Kids / families', '{"Nature","Rivers","National Parks"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/obed/learn/kidsyouth/junior-ranger.htm', 'direct_order_page', 'Official page says if already left, mail booklet and receive badge.', 88),
  ('dinosaur-national-monument-junior-ranger', 'Dinosaur National Monument Junior Ranger', 'National Park Service', 'national_parks', 'Colorado/Utah', 'physical_mail', 'badge', true, 'Junior Ranger badge', 'Complete downloaded book and email photos', 'Ages 5+', '{"Paleontology","Science","National Parks"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/dino/learn/kidsyouth/junior-ranger.htm', 'direct_order_page', 'Park says it will mail a badge.', 89),
  ('thaddeus-kosciuszko-junior-ranger-challenge', 'Thaddeus Kosciuszko Junior Ranger Challenge', 'National Park Service', 'national_parks', 'Pennsylvania', 'physical_mail', 'sticker', true, 'Junior Ranger sticker', 'Email completed challenge + mailing address', 'Ages 8-12', '{"U.S. History","World History"}'::text[], false, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/thko/learn/kidsyouth/junior-ranger.htm', 'direct_order_page', 'Sticker, not badge.', 90),
  ('klondike-gold-rush-junior-ranger', 'Klondike Gold Rush Junior Ranger', 'National Park Service', 'national_parks', 'Alaska', 'physical_mail', 'badge', true, 'Junior Ranger reward/badge', 'Complete booklet, email or mail', 'All ages', '{"U.S. History","Gold Rush","Geography"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/klgo/learn/kidsyouth/juniorranger.htm', 'direct_order_page', 'Updated July 28, 2026; address required for badge.', 91),
  ('devils-postpile-junior-ranger-patch', 'Devils Postpile Junior Ranger Patch', 'National Park Service', 'national_parks', 'California', 'physical_mail', 'patch', true, 'Junior Ranger patch', 'Mail booklet or email completed pages', 'Kids', '{"Geology","Nature","National Parks"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/depo/learn/kidsyouth/junior-ranger.htm', 'direct_order_page', 'Park mails a patch; mailed booklet also gets signed certificate.', 92),
  ('c-o-canal-junior-ranger', 'C&O Canal Junior Ranger', 'National Park Service', 'national_parks', 'Maryland/DC/WV', 'physical_mail', 'badge', true, 'Certificate + badge', 'Complete activity book and contact/mail park', 'Kids / families', '{"History","Engineering","Geography"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/choh/learn/kidsyouth/junior-ranger.htm', 'direct_order_page', 'Official page asks for mailing address to send certificate and badge.', 93),
  ('fort-scott-junior-ranger-ages-3-5', 'Fort Scott Junior Ranger (Ages 3-5)', 'National Park Service', 'national_parks', 'Kansas', 'physical_mail', 'badge', true, 'Junior Ranger badge', 'Complete and mail/email booklet', 'Ages 3-5', '{"U.S. History","Art","Early Learning"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/fosc/learn/kidsyouth/junior-ranger.htm', 'direct_order_page', 'Can request booklet by email if unable to print.', 94),
  ('fort-scott-junior-ranger-ages-6-9', 'Fort Scott Junior Ranger (Ages 6-9)', 'National Park Service', 'national_parks', 'Kansas', 'physical_mail', 'badge', true, 'Junior Ranger badge', 'Complete and mail/email booklet', 'Ages 6-9', '{"U.S. History","Math","Art"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/fosc/learn/kidsyouth/junior-ranger.htm', 'direct_order_page', 'Age-specific booklet.', 95),
  ('fort-scott-junior-ranger-10', 'Fort Scott Junior Ranger (10+)', 'National Park Service', 'national_parks', 'Kansas', 'physical_mail', 'badge', true, 'Junior Ranger badge', 'Complete and mail/email booklet', 'Ages 10+', '{"U.S. History","Math","Art"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/fosc/learn/kidsyouth/junior-ranger.htm', 'direct_order_page', 'Age-specific booklet.', 96),
  ('bryce-canyon-at-home-junior-ranger', 'Bryce Canyon At-Home Junior Ranger', 'National Park Service', 'national_parks', 'Utah', 'physical_mail', 'sticker', true, 'Official sticker badge', 'Email favorite completed page + address', 'Kids / families', '{"Geology","Astronomy","National Parks"}'::text[], false, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/thingstodo/get-your-junior-ranger-badge.htm', 'direct_order_page', 'Sticker badge, not physical wooden/plastic badge.', 97),
  ('c-sar-e-ch-vez-at-home-junior-ranger', 'César E. Chávez At-Home Junior Ranger', 'National Park Service', 'national_parks', 'California', 'physical_mail', 'paper_badge', true, 'Stamped booklet + paper badge', 'Mail completed booklet', 'Kids / families', '{"Civil Rights","Labor History","U.S. History"}'::text[], false, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/cech/learn/juniorranger.htm', 'direct_order_page', 'Paper badge only due shipping costs; updated Aug. 11, 2026.', 98),
  ('wrangell-st-elias-at-home-junior-ranger', 'Wrangell-St. Elias At-Home Junior Ranger', 'National Park Service', 'national_parks', 'Alaska', 'physical_mail', 'sticker', true, 'Sticker + certificate', 'Complete and mail booklet', 'All ages', '{"Nature","Geography","National Parks"}'::text[], false, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/wrst/learn/kidsyouth/beajuniorranger.htm', 'direct_order_page', 'Physical badge is in-person only.', 99),
  ('national-junior-ranger-booklets-by-mail-no-printer', 'National Junior Ranger Booklets by Mail (no printer)', 'National Park Service', 'national_parks', 'Nationwide', 'physical_mail', null, false, 'Requested national-theme Junior Ranger booklet', 'Email Junior_Rangers@nps.gov with mailing address', 'Typically ages 5-14; all welcome', '{"National Parks","Science","History"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/kids/national-booklets-faqs.htm', 'direct_order_page', 'NPS says it will mail requested national booklet if family lacks printer.', 100),
  ('national-junior-ranger-completion-awards', 'National Junior Ranger Completion Awards', 'National Park Service', 'national_parks', 'Nationwide', 'physical_and_printable', 'patch', true, 'Badge, patch, certificate, or other award depending booklet', 'Complete eligible national booklet; email photo + mailing address', 'Typically ages 5-14; all welcome', '{"Science","History","National Parks"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/kids/national-booklets-faqs.htm', 'direct_order_page', 'Only some national theme programs offer physical rewards; verify each booklet page.', 101),
  ('nps-park-explorer-booklet', 'NPS Park Explorer Booklet', 'National Park Service', 'national_parks', 'Nationwide', 'printable', null, false, 'Junior Ranger national-theme booklet', 'Download booklet', 'Kids / families', '{"Trip Planning","Geography","National Parks"}'::text[], false, false, null, null, '2026-08-31', 'verified', 'https://home.nps.gov/kids/junior-rangers.htm', 'direct_order_page', 'Completion award varies.', 102),
  ('nps-wildland-firefighter-booklet', 'NPS Wildland Firefighter Booklet', 'National Park Service', 'national_parks', 'Nationwide', 'printable', null, false, 'Junior Ranger booklet', 'Download booklet', 'Kids / families', '{"Fire Science","Ecology"}'::text[], false, true, null, null, '2026-08-31', 'verified', 'https://home.nps.gov/kids/junior-rangers.htm', 'direct_order_page', 'Completion award varies.', 103),
  ('nps-railroad-explorer-booklet', 'NPS Railroad Explorer Booklet', 'National Park Service', 'national_parks', 'Nationwide', 'printable', null, false, 'Junior Ranger booklet', 'Download booklet', 'Kids / families', '{"U.S. History","Transportation"}'::text[], false, true, null, null, '2026-08-31', 'verified', 'https://home.nps.gov/kids/junior-rangers.htm', 'direct_order_page', 'Completion award varies.', 104),
  ('nps-sounds-explorer-booklet', 'NPS Sounds Explorer Booklet', 'National Park Service', 'national_parks', 'Nationwide', 'printable', null, false, 'Junior Ranger booklet', 'Download booklet', 'Kids / families', '{"Sound Science","Nature"}'::text[], false, true, null, null, '2026-08-31', 'verified', 'https://home.nps.gov/kids/junior-rangers.htm', 'direct_order_page', 'Completion award varies.', 105),
  ('nps-spaceflight-explorer-booklet', 'NPS Spaceflight Explorer Booklet', 'National Park Service / NASA', 'science_space', 'Nationwide', 'printable', null, false, 'Junior Ranger space booklet', 'Download booklet', 'Kids / families', '{"Space","Science","National Parks"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://home.nps.gov/kids/junior-rangers.htm', 'direct_order_page', 'National parks + NASA theme.', 106),
  ('nps-let-s-go-fishing-angler-booklet', 'NPS Let''s Go Fishing Angler Booklet', 'National Park Service', 'nature_wildlife', 'Nationwide', 'printable', null, false, 'Junior Ranger fishing booklet', 'Download booklet', 'Kids / families', '{"Fish","Ecology","Outdoor Education"}'::text[], false, true, null, null, '2026-08-31', 'verified', 'https://www.nps.gov/subjects/fishing/junior-ranger-fishing.htm', 'direct_order_page', 'Physical rewards depend on park/program participation.', 107),
  ('nps-cave-scientist-booklet', 'NPS Cave Scientist Booklet', 'National Park Service', 'science_space', 'Nationwide', 'printable', null, false, 'Junior Ranger cave science booklet', 'Download booklet', 'Kids / families', '{"Earth Science","Geology"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://home.nps.gov/kids/junior-rangers.htm', 'direct_order_page', 'Completion award varies.', 108),
  ('nps-night-skies-explorer-booklet', 'NPS Night Skies Explorer Booklet', 'National Park Service', 'science_space', 'Nationwide', 'printable', null, false, 'Junior Ranger astronomy booklet', 'Download booklet', 'Kids / families', '{"Astronomy","Science"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://home.nps.gov/kids/junior-rangers.htm', 'direct_order_page', 'Completion award varies.', 109),
  ('nps-archeologist-booklet', 'NPS Archeologist Booklet', 'National Park Service', 'history_government', 'Nationwide', 'printable', null, false, 'Junior Ranger archaeology booklet', 'Download booklet', 'Kids / families', '{"Archaeology","History","Science"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://home.nps.gov/kids/junior-rangers.htm', 'direct_order_page', 'Completion award varies.', 110),
  ('nps-underwater-explorer-booklet', 'NPS Underwater Explorer Booklet', 'National Park Service', 'nature_wildlife', 'Nationwide', 'printable', null, false, 'Junior Ranger underwater booklet', 'Download booklet', 'Kids / families', '{"Marine Science","Ecology"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://home.nps.gov/kids/junior-rangers.htm', 'direct_order_page', 'Completion award varies.', 111),
  ('nps-paleontologist-booklet', 'NPS Paleontologist Booklet', 'National Park Service', 'science_space', 'Nationwide', 'printable', null, false, 'Junior Ranger paleontology booklet', 'Download booklet', 'Kids / families', '{"Paleontology","Earth Science"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://home.nps.gov/kids/junior-rangers.htm', 'direct_order_page', 'Completion award varies.', 112),
  ('nps-underground-railroad-explorer', 'NPS Underground Railroad Explorer', 'National Park Service', 'history_government', 'Nationwide', 'printable', null, false, 'Junior Ranger history booklet', 'Download booklet', 'Kids / families', '{"U.S. History","Civil Rights"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://home.nps.gov/kids/junior-rangers.htm', 'direct_order_page', 'Completion award varies.', 113),
  ('texas-farm-bureau-ag-in-the-classroom-publications', 'Texas Farm Bureau Ag in the Classroom Publications', 'Texas Farm Bureau', 'agriculture', 'Texas / Nationwide use', 'printable', null, false, 'Free agriculture publications', 'Download resources', 'K-12', '{"Agriculture","Science","Careers"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://texasfarmbureau.org/youth/ag-in-the-classroom/', 'direct_order_page', 'Includes beef, corn, cotton, dairy, pollinator, poultry, sorghum and more.', 114),
  ('texas-farm-bureau-agriculture-posters', 'Texas Farm Bureau Agriculture Posters', 'Texas Farm Bureau', 'agriculture', 'Texas / Nationwide use', 'printable', null, false, 'Large collection of agriculture posters', 'Download posters', 'K-12', '{"Agriculture","Biology","Food Systems"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://texasfarmbureau.org/youth/ag-in-the-classroom/', 'direct_order_page', 'Topics include cattle, corn, cotton, dairy, forestry, soil, wheat, technology, etc.', 115),
  ('texas-farm-bureau-agriculture-activity-booklets', 'Texas Farm Bureau Agriculture Activity Booklets', 'Texas Farm Bureau', 'agriculture', 'Texas / Nationwide use', 'printable', null, false, 'Dozens of themed activity booklets', 'Download activity books', 'K-8', '{"Agriculture","Science","Food Systems"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://texasfarmbureau.org/youth/ag-in-the-classroom/', 'direct_order_page', 'Topics include bees, bison, pumpkins, honey, hydroponics, pecans, poultry and more.', 116),
  ('arizona-farm-bureau-free-curriculum-kits', 'Arizona Farm Bureau Free Curriculum Kits', 'Arizona Farm Bureau Ag in the Classroom', 'agriculture', 'Arizona', 'local_loan', null, false, 'All-inclusive curriculum kit', 'Reserve/check out kit', 'Varies; K-6+', '{"Agriculture","STEM","ELA","Social Studies"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.azfb.org/Agriculture-in-the-Classroom/Resources/Teacher-Resources/Curriculum-Kits', 'direct_order_page', 'Teacher kits free of charge; local availability/loan logistics apply.', 117),
  ('arizona-agriculture-virtual-resources', 'Arizona Agriculture Virtual Resources', 'Arizona Farm Bureau Ag in the Classroom', 'agriculture', 'Nationwide', 'printable', null, false, 'Virtual tours, presentations, games, free downloads', 'Use online resources', 'K-12', '{"Agriculture","STEM","Geography"}'::text[], true, true, null, null, '2026-08-31', 'verified', 'https://www.azfb.org/agriculture-in-the-classroom', 'direct_order_page', 'Includes 360 farm tours and downloadable First Reader books.', 118),
  ('hillsdale-free-pocket-constitution', 'Hillsdale Free Pocket Constitution', 'Hillsdale College', 'history_government', 'Nationwide', 'physical_mail', null, false, 'Pocket U.S. Constitution', 'Submit request form', 'Middle school+', '{"Civics","U.S. Government","History"}'::text[], false, true, null, null, '2026-08-31', 'verified', 'https://lp.hillsdale.edu/constitution_minute/', 'direct_order_page', 'Private educational organization; useful as optional civics resource.', 119)
on conflict (slug) do update set
  title               = excluded.title,
  organization        = excluded.organization,
  category            = excluded.category,
  state_region        = excluded.state_region,
  delivery_type       = excluded.delivery_type,
  reward_type         = excluded.reward_type,
  is_earn_it          = excluded.is_earn_it,
  what_you_get        = excluded.what_you_get,
  how_to_get_it       = excluded.how_to_get_it,
  age_grade           = excluded.age_grade,
  subjects            = excluded.subjects,
  is_rooted_pick      = excluded.is_rooted_pick,
  is_hidden_gem       = excluded.is_hidden_gem,
  delivery_time       = excluded.delivery_time,
  supply_caveat       = excluded.supply_caveat,
  last_verified       = excluded.last_verified,
  verification_status = excluded.verification_status,
  official_url        = excluded.official_url,
  url_quality         = excluded.url_quality,
  notes               = excluded.notes,
  sort_order          = excluded.sort_order,
  updated_at          = now();
