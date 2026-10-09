import fs from 'node:fs';
import {planAnchoredCascade} from '../app/lib/cascade-shift-plan.ts';
import {computeNextLessonsForGoal,queueHoldsFromRows} from '../app/lib/scheduler.ts';
import {countDoneToday} from '../app/lib/phase2-commit.ts';
process.env.TZ='UTC';
const {snapshot,choice}=JSON.parse(fs.readFileSync(0,'utf8'));
const projection=computeNextLessonsForGoal(snapshot.goal,new Date(snapshot.localDay+'T00:00:00'),3650,snapshot.vacations,countDoneToday(snapshot.rows,snapshot.dayStartIso,snapshot.dayEndIso),queueHoldsFromRows(snapshot.rows));
console.log(JSON.stringify({plan:choice?planAnchoredCascade(snapshot,choice):null,projection}));
