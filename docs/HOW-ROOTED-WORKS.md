# How Rooted Works

A plain-language guide to the app, written from the code as it stood on September 14, 2026. Open it when a support email comes in. Each section says what the feature does, what it looks at, what it saves, what "this year" means to it, and the thing families most often get confused by, with what to tell them.

Where the app does something a family would not expect, this guide says so plainly. Those notes are marked **Known quirk**. They are real behavior today, not typos.

---

## Start here: what "this year" means

Most of Rooted counts things "this year": the Garden, the Your Book strip on Today, the yearbook, the first-memory card, the Reports page's This Year button.

"This year" is the family's current school year, the one they named and dated when they set it up or when they closed their last year.

- It starts on the year's start date, or on the day the year was created if that was earlier. (A family who closed a year on August 20 with a new year starting September 1 has anything they capture from August 20 counted in the new year.)
- It runs until the year's end date, or until today if the end date has already passed. A June photo in a year that "ended" May 31 still counts, until they close the year.
- A family who has never had a school year at all gets August 1 to July 31.

A few places do NOT use this and are called out in their sections: the Memories page, Transcripts, the progress report's quarter buttons, and the family portal.

---

## Quick answers

| A family says... | Section |
|---|---|
| "My tree went back to a seed." | Garden |
| "My book says 0 pages" / "Capture your first memory is back" | Today, Closing a year |
| "I skipped a lesson and it came back." | Plan |
| "Today says I have lessons from earlier, but Plan shows nothing." | Today |
| "It says lessons 1 to 10 are done, but I haven't done lesson 10 yet." | Schedule Builder |
| "My old memories disappeared." | Memories, Billing |
| "My photo isn't in the yearbook." | Yearbook |
| "I rebuilt my subjects from scratch after closing the year." | Closing a year |
| "My past year isn't on the transcript." | Adding a past year, Transcripts |
| "Grandma's comment is posted. How do I take it down?" | Family portal |
| "Settings says I'm on Rooted (Free) but I was gifted a year." | Billing |
| "The hours on Reports don't match the PDF." | Reports |

---

## Today

**What it does**

The home screen. From top to bottom:

- A green header with the family name, a greeting, the date, how many memories this year, how many days this month had something logged, and how many of today's lessons are done.
- A break banner when today is inside a break ("Enjoy your break, school resumes...").
- For newer families: a Getting Started card, a One Question a Month card, and a trial badge.
- "Did you finish?" cards when a subject's current lesson has no record: "Math Lesson 12 was due Sep 10. Did you do it?" with Yes on that day, Yes today, or Not yet.
- Today's lessons, grouped by child, with activities and appointments. When nothing is scheduled: "You have nothing scheduled today. Please enjoy your day!"
- Upcoming, Recurring and Past tabs.
- The capture button. If this school year has no memories yet, it is the big "Capture your first memory" card.
- One suggestion card at a time (see your Garden, try Plan, and so on).
- My Lists, Today's Story (every memory dated today), the Your Book strip (pages, lessons, books and days of school this year), and On This Day (a memory from about a year ago).

**What it looks at**

Each subject's settings (which lesson they are on, how many a day, which days of the week, the start date, any breaks), the lessons themselves, this year's memories, activities, appointments, lists, and the family's garden leaves.

How Today decides which lessons to show: for each subject it takes the next lesson after the last one finished and places lessons forward on that subject's own school days, the number per day the family chose, skipping breaks. A lesson the family moved by hand stays where they put it.

**What it saves**

- Checking off a lesson asks for minutes (or "Just check off"). If the lesson belongs to a different day, it asks which day they did it: today, the day it was planned, or another day. A toast then says "Logged for (day)" with a Change button.
- Unchecking puts the lesson back without moving its date.
- Capturing a memory saves it with the date chosen in the When picker. Photos, drawings, wins, moments, books, field trips and projects all go into the yearbook by default.
- "+ Log extra lessons" marks upcoming lessons done today.
- Every time Today opens it quietly tidies the calendar: it moves each unfinished lesson (that was not moved by hand) to the day it now belongs on, and fills in any lesson that is missing.

**What "this year" means here**

The memory count in the header, the first-memory card, the Your Book strip and the garden leaves are all this school year. The photo count (for the free plan limit) is all time. "Lessons from earlier" looks back up to 14 days.

**Most likely to confuse**

"Today says 3 lessons from earlier, but Plan says I have no missed lessons."

Today's number is worked out from each subject's schedule since its last finished lesson. On that same visit, Today moves unfinished lessons forward onto upcoming days, so by the time the family opens Plan those lessons are no longer in the past and Plan has nothing to show. What to tell them: answer the "You have lessons from earlier" pop-up on Today (Yes if they did them, "reschedule" if not). It opens by itself once per browser session, and tapping "N lessons from earlier · Catch up" on Today reopens it any time.

---

## Plan

**What it does**

The calendar. A week view and a month view of every lesson, activity, appointment and break, plus:

- "You're N lessons behind, want to catch up?" with Re-spread from today or Push schedule back.
- "You have N missed lessons" with Mark all done, Select all, and Reschedule on each one. Each lesson reads like the rows: "Math · Lesson 8", with the curriculum name underneath.
- Cards to Close This School Year, Edit Year Details, Download Progress Report (Rooted+), and Past Years.
- The curriculum list with a pace badge for each subject ("On pace", "N lessons behind", "Finished!") and a menu: Edit, Log past hours, I'm actually on..., Stop, Mark as finished, Delete.
- A + button: add an appointment or event, log a lesson you did, a new activity, a new curriculum, or a break.
- Tapping a day opens it: lessons by child, appointments, notes, and for a past day "Did you do any of this on (day)?"
- Print (daily as a PDF; weekly and monthly are Rooted+).

**What it looks at**

The lessons dated in the weeks on screen, curricula, activities, appointments, breaks, and the family's school years.

**What it saves**

- Checking off a lesson works exactly as on Today, including asking which day.
- Dragging a lesson, or Reschedule, moves it and holds it there. The family can move onto a break day or overfill a day; Plan warns but allows it, with Undo.
- Re-spread and Push back re-plan every unfinished lesson in the affected subjects, with Undo.
- Adding a break can shift every later lesson back by the number of school days in the break (on by default).
- Delete a curriculum: unfinished lessons are removed from the calendar, finished lessons stay on reports, lessons with notes are kept. Stop: the curriculum ends where it is. Mark as finished: it is put away.
- Mark all done (from the banner or select mode) asks once, "Mark these N done on: the day each was planned / today", and files every lesson the way a single check-off with that answer would.

**What "this year" means here**

Plan shows the active school year's first and last day on the calendar. The Download Progress Report "Full year" option is the current school year. Its Q1 to Q4 buttons are four equal slices of that same school year, each labelled with its dates ("Q2 · Nov 7 to Jan 12").

**Most likely to confuse**

"I skipped a lesson and the next one took its day."

That is what Skip means: "we are not doing this one, move on". The lesson leaves the calendar, the next lesson in the book takes its place, and it does not count as done. It is listed under its subject in the curriculum list, greyed, marked Skipped, with Unskip in its menu. For "not today, later", use Reschedule or drag it. A date changed in Edit lesson stays where the family put it.

**Known quirks**

- When the school year's end date has passed and no next year is set up, Plan shows "Your (year) ended (date). Ready to close it?" with Close this year and Keep going. A year never closes on its own.

---

## Schedule Builder

Plan, then + New curriculum. The page is called "Your Schedule".

**What it does**

One card per child. Each curriculum row asks for:

- Subject (Math) and Curriculum (who makes it, e.g. The Good and the Beautiful).
- Days of the week, and how many lessons on each day (0 skips that day).
- Total lessons, minutes per lesson, and optionally a usual start time.
- **"Where are you with this?"** with two choices:
  - **Starting fresh.** They pick the day of the first lesson (tomorrow at the earliest).
  - **Already into it.** They answer one question: **"What lesson are you on next?"** Rooted works out the start date by counting backward over their school days. They can override it with "Change the start date".
- A pace line: lessons a week, how many done, weeks left, "on pace for (month)".

It also takes co-ops and activities. Then Preview schedule, then Save & build schedule.

**The sentence, and what it promises**

Under "Already into it" the family sees a sentence like:

> Lessons 1 to 10 will be marked done over your last 10 school days, Aug 31 through today. Lesson 11 is up Monday, Sep 14.

For "Starting fresh":

> Lesson 1 is up Monday, Sep 14. 120 lessons, 5 a week, finishing around February 2027.

In Preview each curriculum gets a line like "Lessons 1 to 10 done (Aug 31 to today). Lesson 11 on Mon, Sep 14. Finishes about February 2027."

The sentence is a promise, and Save keeps it exactly: it records each of those lessons as done on the dates shown, **including today**, and puts the next lesson on the date shown. For a brand-new curriculum the next lesson always goes on the next school day **after** today, never today, so setting up a curriculum never adds work to the day the family is already living.

If the family's answer cannot fit (they say they are on lesson 182 but only one school day has passed since the start date they typed), Save refuses and says so in plain numbers: "Math: you said 181 lessons are already done, but only 1 school day has passed since your start date of Aug 19. Rooted can only record 1. Move the start date earlier, or lower the completed count." Nothing is saved.

**What it looks at**

Children, active curricula and activities, breaks, and each curriculum's existing lessons.

**What it saves**

- The curricula and activities.
- The lessons: done history for anything already finished, and the upcoming schedule.
- Saving re-plans the unfinished lessons of every curriculum on the page. Lessons the family moved by hand, lessons with notes, and lessons with minutes logged are kept as they are.
- A draft is saved on that device as they type, and offered back if they leave: "We saved your draft."
- The first time a save creates a curriculum, the family sees the "You're Rooted." screen. When the children already have leaves this year it says "Zoe's tree keeps growing." instead of "Two seeds went into the garden today."

**What "this year" means here**

A new curriculum is attached to the family's current school year. The builder itself shows every active curriculum regardless of year.

**Most likely to confuse**

"It says lessons 1 to 10 are done through today, but we haven't done lesson 10 yet" or "Math isn't on Today."

"What lesson are you on next?" means the next one they have not done. If they are about to do lesson 11 today and type 11, Rooted records lesson 10 as done today and puts lesson 11 on the next school day, so nothing for that subject shows on Today today. What to tell them: that is expected for a brand-new curriculum. Rooted never adds a new curriculum's lessons to today. If they do lesson 11 today anyway, they can check it off with "+ Log extra lessons" on Today. Editing an existing curriculum behaves differently: its next lesson can land on today.

**Known quirk:** "Remove curriculum" inside the builder only puts the curriculum away and leaves its lessons alone. The Delete on the Plan page is the one that clears unfinished lessons from the calendar.

---

## Closing a year

Plan, then Close This School Year.

**What it does**

The family names the year they are closing (free text: "2025-2026", "Summer 2026", "Kindergarten Year" all work), names and dates their next year, sees each child's grade, and types CLOSE to confirm.

Afterwards they land on "You finished a year." It says the year is saved, that each child's tree, badges and book are on the Years page, and offers **Set up (next year)** or **Maybe later** (which opens the year-end report).

**What it looks at**

The active year, the children, this year's lessons, memories and badges.

**What it saves**

- The old year is marked closed and the new year becomes the active one. If making the new year fails, the old year is put back exactly as it was, so a family is never left with no year.
- Every curriculum from the closing year is put away, finished or not. Activities are paused.
- Each child's grade moves up one (12th grade becomes Graduated).
- A keepsake of the year: lessons, hours, memories, books, badges, per child.
- Completion certificates.
- The year's yearbook writing and badges are stamped as belonging to that year.

**What "this year" means here**

This is where "this year" changes. The moment the close finishes, the new year is "this year" everywhere: the Garden starts from seeds, the Your Book strip and first-memory card start counting again, and the yearbook starts a new book (while still showing anything the family wrote after the close).

**Most likely to confuse**

"All my subjects are gone" or "I rebuilt everything from scratch."

Closing puts last year's subjects away on purpose. **Set up (next year)** opens the page that copies last year's subjects as a starting point; the family only updates lesson counts and anything that changed. The year-end report's "Set Up Next Year" button goes there too. If they tapped Maybe later, they can find last year on the Years page and use Set Up Next Year from its report.

Also expect: "my child's grade changed" (it advances automatically; they can edit it in Settings) and "my tree reset" (see Garden).

---

## Adding a past year

Years, then Add a past year. For a year a family homeschooled before they found Rooted.

**What it does**

They enter the year's name, start and end dates, school days, and **about how many days they schooled** ("162 days", with a note of how many school days the range holds, which is the default). Then for each child each curriculum: name, subject, total lessons, lessons completed, and minutes per lesson. A review sentence says exactly what will be added: "This adds 180 completed lessons across 4 subjects for Zoe and Emma, dated on 162 school days between Aug 19, 2024 and May 22, 2025, on Mondays to Fridays. It will show under Years, on Reports for those dates, and on the year-end summary. Your 2025-2026 year is not changed."

**What it looks at**

The family's other years, to make sure this one does not overlap any of them. A past year must end before the current year starts, cannot touch another year, and cannot be longer than 400 days.

**What it saves**

A closed school year, its curricula (already put away), one finished lesson for every lesson completed, and the year's keepsake numbers (lessons, hours, days). The lessons are spread in order over exactly the number of days the family gave, chosen evenly between the first and last day, so Days Present on Reports for that year is that number. If anything fails partway, everything it added is removed again, so there is never half a year.

**Changing the days afterward:** on the Years page a filed year shows "180 lessons · 90 hours · 162 days" with **Edit days**. Saving moves that year's lessons onto the new number of days, with the same all-or-nothing rule. Only a year filed this way has it; a year the family lived in Rooted keeps the days they actually logged.

**What "this year" means here**

Nothing changes about this year. Today, Plan, the Garden and the yearbook never see a past year, and a filed year's lessons count toward no badge: they are history the family is recording. The optional note is saved as a win and counts like any win the family writes. Badges already earned stay earned.

**Most likely to confuse**

"My attendance for that year is lower than the days I typed." The days present are the days a lesson sits on. If every curriculum had fewer lessons than the days given (say 100 lessons and 162 days), only the days holding a lesson count, and Rooted says so on the review and stores that number. What to tell them: raise a lesson count or lower the days.

"My past year isn't on the transcript."

Transcripts keep their own list of courses and only copy in subjects that are still active, so a filed past year does not appear there on its own. What to tell them: add those courses on the child's transcript by hand (Courses tab), choosing that year.

---

## Garden

**What it does**

One tree per child. Every leaf is one thing done this school year:

- a completed lesson,
- a captured memory (photo, drawing, win, book, field trip, and so on),
- a completed activity (credited to every child on that activity).

A tree grows through eight stages: Seed (0 leaves), Sprouting (1), Seedling (10), Growing (25), Young Tree (50), Flourishing (100), Blossoming (200), Bearing Fruit (500). Each child's card shows their stage, their leaf count, and how many leaves to the next stage. Reaching a stage shows a one-time celebration. Badges are shown below.

The kids' view (from Settings, Our Kids) draws the same tree with the same count. The "tree just grew a leaf" toast on Today uses the same count too.

**What it looks at**

This year's lessons, memories and activities. Badges earned.

**What it saves**

Only which stage celebrations have been seen, per child, per school year, so a celebration does not repeat on a second device and does come back fresh next year.

**What "this year" means here**

Everything. **A child's tree starts over each school year.** Badges stay earned. Last year's finished tree, with its leaf count and the badges earned that year, lives on the Years page.

**Most likely to confuse**

"My daughter's tree went back to a seed."

That is by design: a new school year plants a new tree. What to tell them: last year's tree is saved on the Years page, next to that year. Badges are not lost.

---

## Memories

**What it does**

Every memory, newest first, grouped by month. Filters for Photos, Favorites and each child, plus Wins, Books, Drawings, Trips and In Yearbook. A search box (with voice search). Tapping a memory opens it: favorite it, see family reactions and comments, make it private from the family portal, edit it, add or remove it from the yearbook, or delete it.

Ways to capture: the Capture a memory button on Today, the camera button on every page (take or choose up to 10 photos with a caption), and the sheets for drawings, wins and moments, books, and field trips or projects.

Captions say "This prints under the photo in your yearbook." That is exactly what happens: the caption (or, for a photo, its title) prints under the photo with the date.

**What it looks at**

The family's memories, children, reflections, and family reactions and comments.

**What it saves**

New memories, edits, favorites, "in the yearbook" on or off, "visible to family" on or off, and deletions (which also remove the photo file). Big photos are shrunk to print quality automatically; iPhone HEIC photos are converted, which can take a moment ("Converting your photo").

**What "this year" means here**

Nothing. The Memories page is not limited to a school year. (The "N memories saved this year" line on the Yearbook tile is really everything the page has loaded, not the school year.)

**Free plan (after the 30-day trial)**

- Only memories dated in the last 30 days show on this page. Older ones are safe and come back on upgrading; the banner says "Your older memories are safe."
- 50 photos in total.

**Most likely to confuse**

"I added an old photo and it vanished" (free families).

The memory saved and used one of their 50 photos, but it is dated more than 30 days back, so the Memories page does not show it on the free plan. What to tell them: it is saved; it will show once they upgrade, and it still counts in the yearbook if it falls in this school year.

**Known quirks**

- Deleting a memory from Today's edit sheet removes the memory but leaves its photo file behind (this does not affect the photo count). Deleting from the Memories page removes both.
- Photos added to a lesson check only whether the family pays, so a family in their trial can hit the 50-photo limit there.

---

## Yearbook

Memories, then Yearbook.

**What it does**

A book that builds itself from the family's year: a cover, contents, each child's chapter (photos, drawings, books, wins), the family chapter, favorites, the letter from home, interviews, a closing note built from the year's real numbers, and more. The Customize page (gear icon) sets the family name and year shown on the cover, the cover photo, the letter, each child's interview answers, which sections appear, and which photos to hide or feature.

Rules the book follows:

- **Nothing empty ever prints.** A section with nothing in it is left out of the book and the contents.
- Every photo prints with at least a date. Captions are never cut off.
- Lesson photos are not in the photo pages.

**What it looks at**

Memories marked "in the yearbook" and dated this school year, the lessons finished this year (for the closing note), the family's yearbook writing, and monthly question answers.

**What it saves**

Only from the Customize page: the writing, cover, section choices, and hide or feature choices.

**What "this year" means here**

The book is this school year's book. After a family closes a year, the reader starts a new book for the new year, while still showing anything they wrote after the close. The year on the cover is what they typed on the Customize page, or the school year's name if they did not.

Today's Your Book strip shows the same book's page count. A hardcover print needs at least 24 pages.

**Free plan (after the 30-day trial):** the first 4 spreads, with a preview watermark, and no printing. Rooted+ shows the whole book and can print or save it.

**Most likely to confuse**

"My photo isn't in the yearbook."

Check three things, in order: is it marked in the yearbook (the bookmark on the memory; lesson photos are left out on purpose); is it dated inside this school year (a memory dated last year belongs to last year's book); was it hidden on the Customize page.

---

## Reports

Two different reports, which is itself a common source of questions.

### Hours & Attendance Log (the Reports page)

**What it does**

Pick a child (or all) and dates, with buttons for This Year, This Month, Last 30 days, and each past year. It shows lessons, hours, books and subjects, a full log to preview, and Print / Save PDF. Below it, the Reading Log: books being read, books finished, and a simple or detailed version to print. Tapping a book lets the family mark it finished, edit it, or delete it.

**What it looks at**

Every completed lesson (any date), memories with time logged, school appointments, books, and the family's school years.

**What it saves**

Only book changes. Marking a book finished dates it today.

**How the numbers work:** hours are each lesson's logged minutes (30 if none were logged) plus time logged on memories. Days present are the days with a finished lesson or a school appointment. For a year filed through Add a past year, that is the number of days the family said they schooled.

**What "this year" means here:** This Year runs from the current school year's start to today.

**Rooted+:** printing the log and the reading log. Previewing is free.

### Progress Report (the PDF from Plan)

**What it does**

Download Progress Report on Plan. Choose a child (or all), a range (Q1 to Q4, Full year, or custom), and whether to include activities. It builds a PDF with totals, each child's subjects, activities, books, field trips, wins, and a day-by-day log.

**What it looks at**

Lessons, memories, activities and each curriculum's usual minutes. It saves nothing.

**How the numbers work:** a lesson with no minutes logged uses the curriculum's usual minutes and is marked estimated.

**What "this year" means here:** Full year is the current school year. Q1 to Q4 are four equal slices of that school year, from its first day to its last, each labelled with its own dates in the dialog. Every day of the year, a leap day included, is in exactly one quarter.

**Rooted+:** the whole report.

**Most likely to confuse (both)**

"The hours on Reports don't match the PDF."

They count slightly differently: Reports assumes 30 minutes for a lesson with no time logged, the PDF uses the curriculum's usual minutes; Reports counts school appointments as days, the PDF counts activities instead; and a lesson finished on a different day than planned can land on different days in each. What to tell them: for an official hours record, use one of the two consistently. Logging minutes when checking off a lesson makes both agree.

---

## Transcripts

**What it does**

One transcript per child (meant for high school). Three tabs:

- **Courses:** add, edit or delete courses (name, category, year, grade, credits, honors, AP or dual enrollment, institution). "Sync from Plan" copies in the child's active subjects.
- **Transcript:** the official transcript as it will print, and Export PDF (Rooted+).
- **GPA:** unweighted and weighted GPA, and credits by subject compared with typical college-ready targets.

Settings: school name, state, graduation year, administrator, weighted GPA on or off, and an optional notary block.

**What it looks at**

Its own course list, the child's curricula (active and past, for syncing), and finished lessons (only to total hours).

**What it saves**

Courses and transcript settings. Opening a child's transcript for the first time automatically adds a course for each of that child's active subjects.

**What "this year" means here**

Transcripts do not use the school year the rest of the app uses. Each course carries a year label like "2026-2027", chosen from a list, and that list changes over in July rather than August.

**Most likely to confuse**

"Why are my total credits different on two tabs?"

The GPA tab adds up credits for every course, graded or not. The Transcript tab and the PDF only include courses that have a grade. What to tell them: give each finished course a grade and the numbers will match; courses without a grade show as "In Progress".

Also: opening a younger child's transcript adds course rows for all of their subjects, and a deleted course comes back on the next sync if the subject is still active on Plan.

---

## Resources and Mail Adventures

### Resources

**What it does**

In order: a Mail Adventures card, Free Printables, Today's Easy Win (changes by day of the month), This Week's Free Picks (three picks that change every Monday), a banner with the family's state homeschool rules, Back to School picks when they are turned on, and Browse Everything (search, plus Curriculum, Online Classes, Science, Field Trips, Printables, Discounts, Virtual Tours, By State, Saved). Every card can be saved, and has a "This didn't work for us" report link.

**What it looks at:** the resource list, the family's state and country, and their saved resources.

**What it saves:** saved resources and problem reports. (Problem reports are only visible in the database today; nothing in the app shows them.) A weekly check emails Brittany a list of broken links; it never hides anything on its own.

**What "this year" means here:** nothing.

**Most likely to confuse:** the state banner and the By State tab use two different sets of state information and can disagree (Alaska reads "Low · 180 days/year" in one place and "No notice required" in the other). The By State tab also only appears when the family's country is set to the United States, while the banner does not check.

### Mail Adventures

**What it does**

A free list of real things a child can request by mail or print: state guides, maps, Junior Ranger items, science and nature materials, from parks, museums and agencies. Filter by All, Rooted Picks, Hidden Gems or Earn It, by category (50 States, National Parks, Science & Space, and more) and by state. Each listing opens the organization's own page to request it. The family marks it Requested, then Received, and when it arrives can tap "Add a memory".

**What it looks at:** the listings (only verified, active ones) and the family's marks.

**What it saves:** Requested and Received, per family. Rooted never asks for or stores an address.

**What "this year" means here:** nothing.

**Most likely to confuse:** the marks are for the whole family, not per child, so a family with three children cannot track which child sent for what.

---

## The family portal (Share with Family)

Settings, Our Family, Share your journey.

**What it does**

The parent invites a person by name and email. That person gets a private link, and no account is needed. On the link they see the family name, the children's names, and every memory marked visible to family, newest first, all time. They can react (five emoji) and comment. The parent is notified by email the first time a link is opened and for every reaction and comment.

The parent can edit a viewer, set their access to end after 30 days, 90 days, a year or never, turn a link off, turn it back on, and preview what family sees.

**What it looks at:** the family's name and children, memories marked visible to family, reactions and comments.

**What it saves:** the invites and their settings, reactions, comments, and notifications.

**What "this year" means here:** nothing. Family sees all time.

**Rules to know**

- Only Rooted+ families (including trial) can add new viewers. If a family goes back to free, links they already shared keep working in full.
- A link never expires unless the parent chose an end date. (A gifted year also sets an end date on every link.) After an end date passes, a family who is not paying shows that viewer only the three newest memories, with no message explaining why.
- Every memory is visible to family unless the parent makes it private from the memory itself.
- Viewers see memories only. They do not see lessons, the garden or the yearbook, even though the Settings card mentions lessons and garden.

**Most likely to confuse**

"Grandma's comment went up straight away. How do I take it down?"

Comments post instantly with no approval. The parent can remove any of them: open the memory in Memories, tap Remove under the comment and confirm ("Remove Grandma's comment? They will not be told."). It disappears from the family portal and the viewer gets no notice. Anyone holding a link can comment, so a forwarded link means someone else can too. What to tell them: remove the comment, and turn that link off in Settings and send a fresh invite if it has been shared further than intended.

**Known quirk:** the weekly "what's new" email to family viewers runs Sundays; it is currently in dry run, not sending, until the founder turns it on.

---

## Billing tiers

**The plans**

| Plan | Price | Notes |
|---|---|---|
| Rooted | Free | After the trial ends |
| Rooted+ Standard | $59 a year | The yearly plan offered today |
| Rooted+ Monthly | $9.99 a month | |
| Rooted+ Founding Family | $39 a year, locked | Early families; no longer offered on the upgrade page |
| Gift | $59, one time | A year of Rooted+ bought for someone |
| Comped | Free | A handful of founding partners |

**The trial**

Every new family gets 30 days of full Rooted+ automatically, no card needed. A trial badge shows early on, and a banner shows in the last 8 days.

**What free families cannot do (after the trial)**

- See memories dated more than 30 days ago on the Memories page (nothing is deleted).
- Have more than 50 photos.
- See more than the first 4 spreads of the yearbook, or print it.
- Print or save: the Hours & Attendance Log, the Reading Log, the Progress Report, transcripts, certificates, ID cards, the year planner, and weekly or monthly Plan printouts.
- Add new family portal viewers.

Everything else is free: Today, Plan, the Schedule Builder, the Garden, Resources, Mail Adventures, and the daily Plan printout.

**What saves and changes**

- Upgrading (on the website, through Stripe) turns on Rooted+ right away. A partner's code can be applied at checkout.
- Manage Subscription in Settings, Account opens Stripe to change or cancel.
- **Cancel:** the family keeps Rooted+ until the end of the time they paid for, then it switches off overnight.
- **Refund:** if any payment on the account was refunded and the subscription is cancelled, Rooted+ ends immediately. A refund alone, without cancelling, changes nothing in the app.
- **Payment failed:** the family gets an email ("Heads up: your Rooted payment didn't go through") and keeps access while Stripe retries.
- **Gift:** bought at /gift (the family must already have an account) or from the family portal. It turns on straight away for a year; there is no code to redeem. It switches off by itself the night after the year ends, unless the family has since started their own subscription. The family portal links the gift extended keep their own end date.

**What "this year" means here:** nothing. The free plan's 30-day memory window is a rolling 30 days, not the school year.

**Most likely to confuse**

"The app says I'm on the free plan but I have everything" (or the reverse).

Different screens word the plan differently. The pricing page says "Your current plan: Rooted" to a family in their trial or a family who cancelled but still has paid time, even though they have full access. Settings shows a gifted family as "Rooted (Free)" right above the line "Your Rooted+ membership is on us." What to tell them: if they can print and see all their memories, they have Rooted+.

Also: on day 31 of the trial, older memories disappear from the Memories page. They are not gone; that is the free plan's 30-day window.

**Known quirks**

- The upgrade page shows "15% off applied" with a fixed price when a partner code is present; the actual discount is whatever that code gives at checkout.
