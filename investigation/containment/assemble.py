"""Offline deterministic packaging; never executes SQL or connects to a database."""
from pathlib import Path
import hashlib,json,subprocess
root=Path(__file__).resolve().parents[2]
b=root/'investigation/containment'
subprocess.run(['python3',str(b/'assemble-wrappers.py')],check=True)
names=['core.sql','wrappers.sql','actions.sql','work-preservation.sql','recalibration.sql','history-healing.sql','calendar.sql','retention.sql']
parts=[]
for name in names:
    source=(b/name).read_text()
    if name=='actions.sql':
        assert source.rstrip().endswith('COMMIT;')
        source=source.rstrip()[:-len('COMMIT;')]
    parts.append('-- SOURCE: '+name+'\n'+source.strip())
sql='\n\n'.join(parts)+'\n\nCOMMIT;\n'
assert sql.count('\nBEGIN;')==1 and sql.count('\nCOMMIT;')==1
for target in ['supabase/proposals/scheduler_containment.sql','supabase/migrations/20261009183309_kandl_protected_scheduler_containment.sql']:
    (root/target).write_text(sql)
manifest={'sources':{n:hashlib.sha256((b/n).read_bytes()).hexdigest() for n in names},'migration':'20261009183309_kandl_protected_scheduler_containment.sql','sha256':hashlib.sha256(sql.encode()).hexdigest(),'activation':'None; empty protected cohort'}
(b/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(manifest['sha256'])
