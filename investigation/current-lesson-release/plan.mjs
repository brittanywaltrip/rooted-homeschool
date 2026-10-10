import fs from 'node:fs';
import {planContainedRecalibration} from '../../app/lib/recalibrate-contained.ts';
const state=JSON.parse(fs.readFileSync(0,'utf8'));
console.log(JSON.stringify(planContainedRecalibration(state,2,false)));
