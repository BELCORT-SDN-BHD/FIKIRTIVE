import fs from 'node:fs';
import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname);
const src = fs.readFileSync(path.join(dir, 'report-source.md'), 'utf8');
const escape = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const inline = s => escape(s).replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'<img loading="lazy" alt="$1" src="$2">').replace(/\[([^\]]*)\]\(([^)]+)\)/g,'<a href="$2">$1</a>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');
const lines = src.split('\n'); let html='', list=false;
for(let i=0;i<lines.length;i++){
 const line=lines[i];
 if(!line.startsWith('- ') && list){html+='</ul>';list=false;}
 if(line.startsWith('```')){let code='';while(++i<lines.length&&!lines[i].startsWith('```'))code+=lines[i]+'\n';html+='<pre>'+escape(code)+'</pre>';continue;}
 if(line.startsWith('|')){let rows=[];while(i<lines.length&&lines[i].startsWith('|')){if(!/^\|[\s|:-]+$/.test(lines[i]))rows.push(lines[i].split('|').slice(1,-1));i++;}i--;html+='<div class="table"><table>'+rows.map((r,j)=>'<tr>'+r.map(c=>`<${j?'td':'th'}>${inline(c.trim())}</${j?'td':'th'}>`).join('')+'</tr>').join('')+'</table></div>';continue;}
 const h=line.match(/^(#{1,3}) (.+)/);if(h){html+=`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;continue;}
 if(line.startsWith('- ')){if(!list){html+='<ul>';list=true;}html+='<li>'+inline(line.slice(2))+'</li>';continue;}
 if(line.trim())html+='<p>'+inline(line)+'</p>';
}
if(list)html+='</ul>';
const missing=[...src.matchAll(/\]\(([^)]+)\)/g)].map(m=>m[1]).filter(p=>!/^https?:/.test(p)&&!fs.existsSync(path.resolve(dir,p)));
if(missing.length)throw Error('Missing local evidence: '+missing.join(', '));
fs.writeFileSync(path.join(dir,'research-report.html'),`<!doctype html><html lang="zh-Hans"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fikirtive Creation & Otto · Research 1.0</title><style>body{margin:0;background:#f7f7f5;color:#232323;font:17px/1.85 system-ui,-apple-system,sans-serif}main{max-width:1000px;margin:48px auto;background:white;padding:60px;border:1px solid #ddd;border-radius:16px}h1{font-size:34px;line-height:1.3}h2{margin-top:56px;padding-top:22px;border-top:1px solid #ddd;font-size:25px}h3{font-size:20px;margin-top:32px}a{color:#ad421e;text-underline-offset:3px}img{display:block;max-width:100%;max-height:740px;object-fit:contain;margin:24px auto;border:1px solid #ddd;border-radius:8px}pre{background:#f5f5f4;padding:24px;white-space:pre-wrap;line-height:1.9}code{background:#f4f4f2;padding:2px 4px}.table{overflow:auto}table{border-collapse:collapse;font-size:15px;width:100%}td,th{text-align:left;vertical-align:top;padding:12px;border:1px solid #ddd}th{background:#f3f3f1}@media(max-width:700px){main{margin:0;padding:24px;border:0;border-radius:0}}@media print{main{border:0;padding:0;margin:0}h2{break-after:avoid}img,tr{break-inside:avoid}a{color:inherit}}</style><main>${html}</main></html>`);
console.log('Rendered report; local evidence links validated.');
