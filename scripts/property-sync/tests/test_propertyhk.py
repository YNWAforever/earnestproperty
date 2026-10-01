import sys,copy,json,hashlib,importlib.util
from pathlib import Path
import pytest
sys.path.insert(0,str(Path(__file__).parents[1]))
from scraping import worker as w
spec=importlib.util.spec_from_file_location('daily_propertyhk',Path(__file__).parents[1]/'daily_artifacts.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)

def full_fixture():
 cfg,fixtures=w.synthetic_fixture('propertyhk');p,_=w.crawl('propertyhk',cfg,fixtures);return cfg,fixtures,p

def test_full_propertyhk_is_not_absence_authorization_and_private_manifest_accepts_it(tmp_path):
 cfg,fixtures,p=full_fixture();assert p['meta']['eligible_for_absence'] is False
 request=tmp_path/'request.json';request.write_text(json.dumps(p),encoding='utf-8');raw=tmp_path/'raw.tar.gz';raw.write_bytes(b'synthetic')
 a.freeze_manifest(request,raw,tmp_path/'handoff.json',git_sha='a'*40,gate=w.gate(p,None))
 assert a.verify_manifest(tmp_path/'handoff.json',tmp_path,source='propertyhk')['source']=='propertyhk'

@pytest.mark.parametrize('case',['missing_first','blocked','repeat','detail_missing','missing_license','generic_directory','fake_empty','conflict','drop'])
def test_synthetic_branch_failures_never_form_full_or_absence(case):
 cfg,fixtures,p=full_fixture()
 if case=='missing_first':
  p['meta']['pages']=[x for x in p['meta']['pages'] if not(x['scope']=='EPS' and x['page']==1)]
 elif case=='drop':
  baseline=copy.deepcopy(p);baseline['listings'].append(copy.deepcopy(baseline['listings'][0]))
  baseline['listings'][1]['property_id']='other'
  assert w.gate(p,baseline)['full'] is False;return
 else:
  index=cfg['branch_urls']['EPT'].format(page=2)
  if case=='blocked':fixtures[index]={'status':403,'html':'challenge'}
  elif case=='repeat':fixtures[index]=fixtures[cfg['branch_urls']['EPT'].format(page=1)]
  elif case=='detail_missing':fixtures.pop('https://www.property.hk/detail/100')
  elif case=='missing_license':fixtures[index]={'html':'<main>SYNTHETIC COMPANY<p class="empty">No records</p></main>'}
  elif case=='generic_directory':fixtures[index]={'html':'<h1>代理目錄</h1>'}
  elif case=='fake_empty':fixtures[index]={'html':'<main>SYNTHETIC COMPANY SYNTHETIC-LICENSE</main>'}
  elif case=='conflict':
   index=cfg['branch_urls']['EPT'].format(page=1)
   fixtures[index]={'html':'<main>SYNTHETIC COMPANY SYNTHETIC-LICENSE<article><span class="id">100</span><a href="/detail/100">Conflicting title</a></article></main>'}
  p,_=w.crawl('propertyhk',cfg,fixtures)
 assert w.gate(p,None)['full'] is False
 assert p['meta']['eligible_for_absence'] is False

def test_source_isolated_baseline_and_latest_selection(tmp_path):
 _,_,p=full_fixture();request=tmp_path/'request.json';request.write_text(json.dumps(p),encoding='utf-8')
 receipt=tmp_path/'receipt.json';receipt.write_text(json.dumps({'success':True,'status':'success','full_snapshot':True,'receipt_id':'r'}),encoding='utf-8')
 a.make_baseline(request,receipt,tmp_path/'bundle');a.restore_baseline(tmp_path/'bundle',tmp_path/'out')
 assert (tmp_path/'out/baselines/propertyhk/branches-EPW-EPS-EPT/baseline.json').read_bytes()==request.read_bytes()
 assert not (tmp_path/'out/baselines/28hse').exists()
 hk=a.accepted_name(request,'1','1');assert hk.startswith('accepted-propertyhk-')
 old='accepted-20260924T214554421920Z-1-1.tar.gz'
 assert a.latest_accepted([old,hk],source='propertyhk')==hk
 assert a.latest_accepted([old,hk])==old
def test_same_global_id_dual_offer_uses_distinct_sale_rent_keys():
 cfg,fixtures,_=full_fixture();cfg['selectors']['deal_type']='.offer';cfg['offer_values']={'both':['sale','rent']}
 html='<main>SYNTHETIC COMPANY SYNTHETIC-LICENSE<article><span class="id">100</span><span class="offer">both</span><a href="/detail/100">Dual</a></article></main>'
 for b in w.BRANCHES:fixtures[cfg['branch_urls'][b].format(page=1)]={'html':html}
 cfg['selectors']['fields']['rent']='.rent';fixtures['https://www.property.hk/detail/100']['html']=fixtures['https://www.property.hk/detail/100']['html'].replace('</main>','<p class="rent">$18000</p></main>')
 p,_=w.crawl('propertyhk',cfg,fixtures)
 assert w.gate(p,None)['full'] is True
 assert {(r['property_id'],r['deal_type']) for r in p['listings']}=={('100','sale'),('100','rent')}
 assert all(r['branch_memberships']==['EPW','EPS','EPT'] for r in p['listings'])
 assert p['meta']['eligible_for_absence'] is False

 assert next(r for r in p['listings'] if r['deal_type']=='rent')['rent']=='18000'
