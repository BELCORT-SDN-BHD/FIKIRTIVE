import os,sys,pathlib,re,subprocess,json,time,uuid
root=pathlib.Path('/Users/winnin/.codex/worktrees/e2e-round3-20260914/FIKIRTIVE')
logs=root/'docs/audits/fullstack-staging-2026-09-14/local-logs'
env={k:os.environ[k] for k in ['PATH','HOME','LANG','TMPDIR'] if k in os.environ}
env['PATH']='/opt/homebrew/opt/node@22/bin:'+env['PATH']
# Only source names are read; no secret environment files are loaded.
source=(root/'e2e/support/env.ts').read_text()
keys=re.findall(r'^\s+"([A-Z][A-Z0-9_]+)",?$',source,re.M)
for k in keys+['DATABASE_URL_POOLED','NEXT_PUBLIC_SENTRY_DSN','SENTRY_AUTH_TOKEN','STORAGE_DRIVER','R2_FORCE_PATH_STYLE','ANTHROPIC_BASE_URL']:
 env[k]=''
env.update(DATABASE_URL='postgresql://winnin@127.0.0.1:5432/round3_base_test',NODE_OPTIONS='--max-old-space-size=6144',DB_POOL_MAX='4',NEXT_TELEMETRY_DISABLED='1',CI='1')
for d in [root,root/'apps/web',root/'packages/db']:
 for p in d.glob('.env*'):
  if p.name!='.env.example': raise SystemExit('Refusing environment file: '+str(p))
stage=sys.argv[1];args=sys.argv[2:]
if stage.split('-')[0] in ['web','worker','dbrecheck','fullstack']:
 env['DATABASE_URL']='postgresql://winnin@127.0.0.1:5432/'+(logs/(stage.split('-')[0]+'-db-name.txt')).read_text().strip()
if stage.startswith('e2e'):
 env['DATABASE_URL']='postgresql://winnin@127.0.0.1:5432/'+(logs/'e2e-db-name.txt').read_text().strip()
 env['E2E_PORT']='3399'
if stage.startswith('quality'):
 env['FIKIRTIVE_TEST_DB']='round3_'+uuid.uuid4().hex[:16]+'_test'
 # Never allow reusing any existing database.
 for name in [env['FIKIRTIVE_TEST_DB'],env['FIKIRTIVE_TEST_DB'][:-5]+'_worker_test']:
  found=subprocess.check_output(['psql','-h','127.0.0.1','-U','winnin','-d','postgres','-w','-Atc',"SELECT datname FROM pg_database WHERE datname='"+name+"'"],env=env,text=True).strip()
  if found:raise SystemExit('Name collision; refusing reuse')
start=time.time()
with (logs/(stage+'.log')).open('w') as f:
 p=subprocess.run(args,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT)
result={'stage':stage,'command':args,'exit':p.returncode,'seconds':round(time.time()-start,2),'database':env['DATABASE_URL'].rsplit('/',1)[-1]}
with (logs/'results.jsonl').open('a') as f:f.write(json.dumps(result)+'\n')
print(json.dumps(result),flush=True)
sys.exit(p.returncode)
