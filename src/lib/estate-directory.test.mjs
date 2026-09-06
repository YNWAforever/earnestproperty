import test from 'node:test';
import assert from 'node:assert/strict';
import {groupEstateDirectory,estateListingHref} from './estate-directory.ts';
const rows=[{slug:'mun-ming-shan',nameZh:'滿名山',nameEn:'The Bloomsway',aliases:[],districtSlug:'castle-peak-road',total:9,sale:5,rent:5},{slug:'bellagio',nameZh:'碧堤半島',nameEn:'Bellagio',aliases:[],districtSlug:'sham-tseng',total:33,sale:20,rent:15}];
test('directory groups all rows and searches normalized names and registered aliases',()=>{
 assert.equal(groupEstateDirectory(rows,'').flatMap(g=>g.estates).length,2);
 assert.equal(groupEstateDirectory(rows,'THE BLOOMS WAY')[0].estates[0].slug,'mun-ming-shan');
 assert.equal(groupEstateDirectory(rows,'滿名')[0].estates.length,1);
 assert.deepEqual(groupEstateDirectory(rows,'no such estate'),[]);
});
test('sale and rental shortcuts carry exact estate filters',()=>{
 assert.equal(estateListingHref('mun-ming-shan','sale'),'/listings?estate=mun-ming-shan&deal=sale');
 assert.equal(estateListingHref('bellagio','rent'),'/listings?estate=bellagio&deal=rent');
});

test('registry display region takes precedence over database district fallback',()=>{
 const row={...rows[0],slug:'hong-kong-garden',nameZh:'豪景花園',districtSlug:'sham-tseng'};
 assert.equal(groupEstateDirectory([row],'')[0].label,'青山公路');
});
