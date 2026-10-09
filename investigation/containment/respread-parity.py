import subprocess,json
from pathlib import Path
B=Path(__file__).resolve().parents[3]/'synthetic-runtime'
D=['/Users/brittanywaltrip/.docker/bin/docker','--host','unix:///Users/brittanywaltrip/.colima/rooted-isolated/docker.sock','exec','-i','supabase_db_rooted-isolated-local','psql','-X','-qAt','-U','postgres','-d','rooted_containment_rehearsal','-v','ON_ERROR_STOP=1']
def sql(s):
 p=subprocess.run(D,input=s,text=True,capture_output=True);assert p.returncode==0,p.stderr;return p.stdout.strip()
sql((B.parent/'rooted-release-package/investigation/containment/parent-respread.sql').read_text().replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace('create function','create or replace function'))
cases=json.loads((B/'respread-parity-cases.json').read_text());failed=[]
for i,c in enumerate(cases):
 got=json.loads(sql("SELECT rooted_private.scheduler_project_dates('"+json.dumps(c['state']).replace("'","''")+"'::jsonb);"))
 if got!=c['expected']:failed.append({'case':i,'got':got,'expected':c['expected']})
print(json.dumps({'cases':len(cases),'passed':len(cases)-len(failed),'failed':failed[:8]},indent=2));assert not failed
