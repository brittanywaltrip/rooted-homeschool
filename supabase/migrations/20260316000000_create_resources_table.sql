-- ============================================================
-- Migration: Create resources table
-- Run this in your Supabase SQL Editor
-- ============================================================

create table if not exists public.resources (
  id          uuid        default gen_random_uuid() primary key,
  category    text        not null check (category in ('discounts', 'field_trips', 'printables', 'science')),
  title       text        not null,
  description text        not null default '',
  url         text        not null default '',
  grade_level text        not null default 'All Ages',
  badge_text  text        not null default '',
  active      boolean     not null default true,
  sort_order  integer     not null default 0,
  metadata    jsonb       not null default '{}',
  created_at  timestamptz not null default now()
);

-- Enable RLS
alter table public.resources enable row level security;

-- Anyone (authenticated or not) can read active resources
create policy "Public read active resources"
  on public.resources for select
  using (active = true);

-- Admin can read everything including inactive
create policy "Admin read all resources"
  on public.resources for select
  using (auth.jwt() ->> 'email' = 'garfieldbrittany@gmail.com');

-- Admin write policies
create policy "Admin insert resources"
  on public.resources for insert
  with check (auth.jwt() ->> 'email' = 'garfieldbrittany@gmail.com');

create policy "Admin update resources"
  on public.resources for update
  using (auth.jwt() ->> 'email' = 'garfieldbrittany@gmail.com');

create policy "Admin delete resources"
  on public.resources for delete
  using (auth.jwt() ->> 'email' = 'garfieldbrittany@gmail.com');

-- ============================================================
-- Seed data: migrate all existing hardcoded resources
-- ============================================================

insert into public.resources (category, title, description, url, grade_level, badge_text, sort_order, metadata) values

-- ── Discounts ──────────────────────────────────────────────
('discounts', 'Michaels Educator Discount',
 '15% off your entire purchase for homeschool educators. Show homeschool documentation at checkout or customer service.',
 'https://www.michaels.com/coupon-policy-and-price-guarantee#teacher-discount',
 'All Ages', '15% off', 1, '{"tags": ["Art", "Crafts", "Supplies"]}'),

('discounts', 'Apple Education Pricing',
 'Up to 10% off Macs and iPads for homeschool families through Apple''s education store. Ships directly to your door.',
 'https://www.apple.com/us-hed/shop',
 'All Ages', 'Up to 10%', 2, '{"tags": ["Tech"]}'),

('discounts', 'Books-A-Million Educator Discount',
 '20% off in-store for homeschool educators with an educator card. Apply online or at your local store.',
 'https://www.booksamillion.com/educators',
 'All Ages', '20% off', 3, '{"tags": ["Books"]}'),

('discounts', 'JoAnn Fabrics Teacher Discount',
 '15% off every day for homeschool educators. Show a homeschool ID or letter at checkout — no minimum purchase required.',
 'https://www.joann.com/teacher-discount/',
 'All Ages', '15% off', 4, '{"tags": ["Art", "Crafts"]}'),

('discounts', 'Office Depot / OfficeMax Teacher Rewards',
 'Free membership gives 5–10% back in rewards on eligible purchases. Valid for homeschool families with educator verification.',
 'https://www.officedepot.com/l/teacher-rewards',
 'All Ages', '5–10% back', 5, '{"tags": ["Supplies", "Tech"]}'),

('discounts', 'Staples Teacher Rewards',
 'Free program offering 5% back in rewards on purchases. Enroll online and start earning immediately.',
 'https://www.staples.com/sbd/cre/marketing/teacherrewards/',
 'All Ages', '5% back', 6, '{"tags": ["Supplies", "Tech"]}'),

('discounts', 'ThriftBooks 4 Teachers',
 'Buy 4 books, get 1 free for homeschool educators. Verified used books at deep discounts — great for building your library.',
 'https://www.thriftbooks.com/programs/educators/',
 'All Ages', 'Buy 4 get 1', 7, '{"tags": ["Books"]}'),

('discounts', 'Half Price Books Educator Discount',
 '10% off year-round with an educator discount card. Apply in-store with homeschool documentation.',
 'https://www.halfpricebooks.com/educator-discount/',
 'All Ages', '10% off', 8, '{"tags": ["Books"]}'),

-- ── Field Trips ────────────────────────────────────────────
('field_trips', 'Smithsonian Museum of Natural History',
 'Explore virtual tours of dinosaurs, ocean life, human origins, and gem collections — all from home.',
 'https://naturalhistory.si.edu/visit/virtual-tour',
 'All Ages', '', 1, '{}'),

('field_trips', 'Google Arts & Culture',
 'Virtual museum tours from the Louvre, MoMA, the Vatican Museums, and hundreds more. Also includes street-level art walks.',
 'https://artsandculture.google.com',
 'All Ages', '', 2, '{}'),

('field_trips', 'NASA Virtual Tours',
 'Tour the Kennedy Space Center, Jet Propulsion Lab, and explore the International Space Station in 360°.',
 'https://www.nasa.gov/learning-resources/virtual-tours',
 '6–8', '', 3, '{}'),

('field_trips', 'San Diego Zoo Virtual Safari',
 'Live animal cams, educational videos, and virtual field trips for giraffes, pandas, and more.',
 'https://zoo.sandiegozoo.org',
 'K–2', '', 4, '{}'),

('field_trips', 'Monterey Bay Aquarium Live Cams',
 'Watch sharks, jellyfish, sea otters, and kelp forests live 24/7. Lesson plans available on their educator site.',
 'https://www.montereybayaquarium.org/animals/live-cams',
 'All Ages', '', 5, '{}'),

('field_trips', 'The Louvre Museum, Paris',
 'Explore collections with guided virtual tours, artwork close-ups, and curatorial commentary. No French required!',
 'https://www.louvre.fr/en/online-tours',
 '9–12', '', 6, '{}'),

('field_trips', 'Yellowstone National Park',
 'Ranger-led virtual programs, live webcams of geysers and wildlife, and downloadable field journals for kids.',
 'https://www.nps.gov/yell/learn/photosmultimedia/virtualtours.htm',
 '3–5', '', 7, '{}'),

('field_trips', 'Cincinnati Zoo Home Safari',
 'Daily live streams featuring animals and zookeepers. Archive of past safaris available for on-demand viewing.',
 'https://cincinnatizoo.org/home-safari',
 'K–2', '', 8, '{}'),

('field_trips', 'National Geographic Classroom',
 'Short documentary videos, photo essays, and interactives on geography, science, culture, and nature.',
 'https://www.nationalgeographic.org/education/classroom-resources',
 '6–8', '', 9, '{}'),

-- ── Printables ─────────────────────────────────────────────
('printables', 'Khan Academy',
 'Printable math worksheets that align with their video lessons, from kindergarten through high school.',
 'https://www.khanacademy.org',
 '3–5', '', 1, '{"subjects": ["Math"]}'),

('printables', 'Education.com',
 'Thousands of worksheets, games, and lesson plans organized by grade and subject. Free tier is generous.',
 'https://www.education.com',
 'All Ages', '', 2, '{"subjects": ["All subjects"]}'),

('printables', 'Math-Drills.com',
 'Thousands of free math worksheets covering arithmetic, algebra, geometry, and more. No account needed.',
 'https://www.math-drills.com',
 '3–5', '', 3, '{"subjects": ["Math"]}'),

('printables', 'ReadWorks',
 'Free reading comprehension passages and question sets for K–12. Scientifically-based literacy resources.',
 'https://www.readworks.org',
 '3–5', '', 4, '{"subjects": ["Reading", "ELA"]}'),

('printables', 'Teachers Pay Teachers (Free)',
 'Filter for free resources — thousands of units, lesson plans, and printables created by educators.',
 'https://www.teacherspayteachers.com/Browse/Price-Range/Free',
 'All Ages', '', 5, '{"subjects": ["All subjects"]}'),

('printables', 'Worksheet Works',
 'Customizable math and language arts worksheets you can tailor to your child''s level and preferences.',
 'https://www.worksheetworks.com',
 'K–2', '', 6, '{"subjects": ["Math", "ELA"]}'),

('printables', 'Starfall',
 'Free phonics and early reading activities, games, and printables for ages 3–8.',
 'https://www.starfall.com',
 'K–2', '', 7, '{"subjects": ["Reading", "Phonics"]}'),

('printables', 'CK-12',
 'Free, customizable digital textbooks, practice problems, and simulations for every grade and subject.',
 'https://www.ck12.org',
 '6–8', '', 8, '{"subjects": ["All subjects", "STEM"]}'),

-- ── Science Projects ───────────────────────────────────────
('science', 'Baking Soda Volcano',
 'A classic chemical reaction that demonstrates acid-base chemistry. Add dish soap to make a dramatic foam eruption.',
 'https://www.sciencebuddies.org/science-fair-projects/project-ideas/Chem_p10/chemistry/baking-soda-vinegar-volcano',
 'K–2', 'Easy', 1, '{"time": "30 min", "materials": "Baking soda, vinegar, dish soap, food coloring"}'),

('science', 'Crystal Growing',
 'Create beautiful crystals by supersaturating a water solution. Different salts create different crystal shapes.',
 'https://www.sciencebuddies.org/science-fair-projects/project-ideas/Chem_p015/chemistry/crystal-growing',
 '3–5', 'Medium', 2, '{"time": "3–7 days", "materials": "Borax or table salt, string, hot water, jar"}'),

('science', 'Water Filtration System',
 'Build a multi-layer filter to clean muddy water. Teaches environmental science and engineering design.',
 'https://www.sciencebuddies.org/science-fair-projects/project-ideas/EnvSci_p016',
 '6–8', 'Medium', 3, '{"time": "1 hour", "materials": "Plastic bottles, sand, gravel, cotton balls, muddy water"}'),

('science', 'Egg Float / Sink Experiment',
 'Explore density by dissolving different amounts of salt in water. An egg floats in salty water but sinks in fresh.',
 'https://www.sciencebuddies.org/science-fair-projects/project-ideas/OceanSci_p012',
 'K–2', 'Easy', 4, '{"time": "20 min", "materials": "Eggs, water, salt, two containers"}'),

('science', 'Chromatography Art',
 'Separate ink colors using water absorption. Produces beautiful art while teaching about chemical separation.',
 'https://www.sciencebuddies.org/science-fair-projects/project-ideas/Chem_p007',
 '3–5', 'Easy', 5, '{"time": "30 min", "materials": "Coffee filters, washable markers, water, pencil"}'),

('science', 'Homemade Electromagnet',
 'Wrap copper wire around an iron nail, connect to a battery, and pick up paper clips. Teaches electromagnetism.',
 'https://www.sciencebuddies.org/science-fair-projects/project-ideas/Elec_p014',
 '6–8', 'Medium', 6, '{"time": "45 min", "materials": "Iron nail, copper wire, 9V battery, paper clips"}'),

('science', 'Bean in a Bag Germination',
 'Tape a damp paper towel with a bean seed inside a sunny window. Watch the root and shoot emerge over days.',
 'https://www.sciencebuddies.org/science-fair-projects/project-ideas/PlantBio_p021',
 'K–2', 'Easy', 7, '{"time": "5–10 days", "materials": "Ziplock bag, bean seeds, damp paper towel, tape"}'),

('science', 'Homemade Slime',
 'Create a substance that acts like both a liquid and a solid. Teaches chemistry and the properties of polymers.',
 'https://www.sciencebuddies.org/science-fair-projects/project-ideas/Chem_p108',
 'K–2', 'Easy', 8, '{"time": "20 min", "materials": "Elmer''s glue, baking soda, contact lens solution"}');
