import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
import pytest
sys.path.insert(0, str(Path(__file__).parents[1]))
from scraping import worker as w

# Synthetic values in the structural contract observed on approved real pages.
# Original HTML, source IDs, SID and contacts stay in the private evidence folder.
URL='https://www.property.hk/agent.php?dt=NTM&agent=EPS&sid=SYNTHETIC'
LICENSE='C-018613-A000'

def fixture(page=1,pages=2):
 rows=[]
 for ident,sale,rent in [('101','920 <i>萬</i>','--'),('102','700 <i>萬</i>','$22,000'),('103','--','$18,000')]:
  rows.append(f'''<tr><td><input type="checkbox" name="cbox[{ident}]" value="{ident}"></td>
  <td><a href="/asking_detail/{ident}.html">photo</a></td><td>屯門</td>
  <td><span class="bname">Synthetic home</span><div>更新日期：2026-10-01</div></td>
  <td>高層</td><td>959</td><td>741</td><td><div class="saleprice">{sale}</div></td>
  <td><div class="rentprice">{rent}</div></td><td><a href="/asking_detail/{ident}.html">樓盤詳情</a></td></tr>''')
 return f'''<html><title>晉誠地產</title><table class="bd_table"><tr><td>晉誠地產代理有限公司 (麗都花園)</td></tr><tr><td>牌照：</td><td>{LICENSE}</td></tr></table>
 <table class="hidden-xs table table-hover"><thead><tr>{''.join('<th>'+v+'</th>' for v in ['全選','相片','地區','物業資料','樓層','建築(呎)','實用(呎)','售價(萬)','租金(HK$)',''])}</tr></thead>{''.join(rows)}</table>
 <div class="visible-xs"><input name="cbox[101]" value="101"></div>
 <form name="jumpForm" action="/agent.php" method="get"><span>共 {pages} 頁，跳至</span>
 <input name="p" placeholder="{page}" type="text"><input name="dt" value="NTM" type="hidden">
 <input name="agent" value="EPS" type="hidden"><input name="sid" value="SYNTHETIC" type="hidden"></form></html>'''

def inspect(html=None,url=URL):
 return w.inspect_property_agent_index(html or fixture(),url,expected_license=LICENSE)

def test_observed_agent_table_separates_ads_offers_and_keeps_partial_authority():
 result=inspect()
 assert result['advertisement_count']==3
 assert [(x['property_id'],x['deal_type']) for x in result['listings']]==[('101','sale'),('102','sale'),('102','rent'),('103','rent')]
 assert result['listings'][0]['price']=='9200000'
 assert result['listings'][2]['rent']=='22000'
 assert result['listings'][0]['saleable_area']=='741'
 assert result['listings'][0]['source_updated_date']=='2026-10-01'
 assert result['listings'][0]['source_url']=='https://www.property.hk/asking_detail/101.html'
 assert result['full_snapshot'] is False and result['details_verified'] is False
 assert result['eligible_for_absence'] is False and result['id_scope_verified'] is False
 assert all(x.get('unit') is None and x.get('company_property_no') is None for x in result['listings'])
 assert parse_qs(urlsplit(result['next_url']).query)=={'dt':['NTM'],'agent':['EPS'],'sid':['SYNTHETIC'],'p':['2']}

def test_last_nonempty_page_is_index_boundary_not_full_source_acceptance():
 result=inspect(fixture(2,2),URL+'&p=2')
 assert result['is_last_listed_page'] is True and result['next_url'] is None
 assert result['advertisement_count']==3 and result['full_snapshot'] is False

@pytest.mark.parametrize('old,new,error',[
 ('C-018613-A000','C-999999','company_identity'),
 ('晉誠地產代理有限公司','Other Agency','company_identity'),
 ('value="EPS"','value="EPT"','pagination_identity'),
 ('value="NTM"','value="NTW"','pagination_identity'),
 ('value="SYNTHETIC"','value="CHANGED"','pagination_identity'),
 ('action="/agent.php"','action="https://other.invalid/"','pagination_identity'),
 ('placeholder="1"','placeholder="2"','pagination_identity'),
 ('共 2 頁','共 0 頁','pagination_identity'),
 ('/asking_detail/101.html','/asking_detail/999.html','index_identity'),
 ('value="101"','value="1e3"','index_identity'),
 ('920 <i>萬</i>','oops','invalid_number'),
 ('2026-10-01','2026-02-30','source_updated_date'),
 ('售價(萬)','售價(HK$)','index_columns'),
 ('value="102"','value="101"','index_identity'),
])
def test_contract_drift_and_identity_conflicts_fail_closed(old,new,error):
 with pytest.raises(w.WorkerError,match=error):inspect(fixture().replace(old,new))

def test_fake_empty_challenge_and_unapproved_url_never_become_terminal():
 for html in ['<html>沒有資料</html>','<title>Just a moment</title>']:
  with pytest.raises(w.WorkerError):inspect(html)
 for url in [URL.replace('www.property.hk','other.invalid'),URL+'&agent=EPT',URL.replace('agent.php','directory.php')]:
  with pytest.raises(w.WorkerError):inspect(url=url)

def test_private_evidence_verifier_checks_bytes_and_contiguous_index_pages(tmp_path):
 import importlib.util, json, hashlib
 spec=importlib.util.spec_from_file_location('index_evidence',Path(__file__).parents[1]/'verify_propertyhk_index_evidence.py')
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 manifest=[]
 for page in (1,2):
  url=URL if page==1 else URL+'&p=2'
  raw=fixture(page,2).replace('value="101"',f'value="{page}01"').replace('/101.html',f'/{page}01.html').replace('value="102"',f'value="{page}02"').replace('/102.html',f'/{page}02.html').replace('value="103"',f'value="{page}03"').replace('/103.html',f'/{page}03.html').encode()
  name=hashlib.sha256(url.encode()).hexdigest()+'.raw';(tmp_path/name).write_bytes(raw)
  manifest.append({'url':url,'status':200,'file':name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
 entries={'EPS-NTM':URL};report=module.verify_evidence(manifest,entries,tmp_path)
 assert report['entries']['EPS-NTM']['advertisements']==6
 assert report['full_snapshot'] is False and report['eligible_for_absence'] is False
 with pytest.raises(w.WorkerError,match='incomplete_index_pages'):module.verify_evidence(manifest[:1],entries,tmp_path)
 bad=[{**manifest[0],'sha256':'0'*64},manifest[1]]
 with pytest.raises(w.WorkerError,match='evidence_hash'):module.verify_evidence(bad,entries,tmp_path)
 bad=[{**manifest[0],'file':'../outside.raw'},manifest[1]]
 with pytest.raises(w.WorkerError,match='evidence_path'):module.verify_evidence(bad,entries,tmp_path)
