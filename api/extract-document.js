export const config={maxDuration:30};

function extOf(name=''){const m=String(name).toLowerCase().match(/\.([a-z0-9]+)$/);return m?m[1]:''}
function cleanXmlText(xml=''){return String(xml).replace(/<w:tab\/?\s*>/g,'\t').replace(/<a:br\/?\s*>/g,'\n').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim()}

export async function extractDocumentBuffer(buffer,name,type=''){
  const ext=extOf(name);
  if(ext==='txt'||ext==='csv'||String(type).startsWith('text/'))return Buffer.from(buffer).toString('utf8');
  if(ext==='doc'||ext==='ppt')throw new Error(`Legacy .${ext} is not reliably parseable in the current FOC web preview. Save/convert it as .${ext}x and upload again.`);
  if(ext==='pdf'){
    const mod=await import('pdf-parse');const pdf=mod.default||mod;const out=await pdf(Buffer.from(buffer));return out.text||'';
  }
  if(ext==='docx'){
    const mod=await import('mammoth');const mammoth=mod.default||mod;const out=await mammoth.extractRawText({buffer:Buffer.from(buffer)});return out.value||'';
  }
  if(ext==='xls'||ext==='xlsx'){
    const mod=await import('xlsx');const XLSX=mod.default||mod;const wb=XLSX.read(Buffer.from(buffer),{type:'buffer'});return wb.SheetNames.map(n=>`[Sheet: ${n}]\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n\n');
  }
  if(ext==='pptx'){
    const mod=await import('jszip');const JSZip=mod.default||mod;const zip=await JSZip.loadAsync(Buffer.from(buffer));const names=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/i.test(n)).sort((a,b)=>Number(a.match(/slide(\d+)/i)?.[1]||0)-Number(b.match(/slide(\d+)/i)?.[1]||0));const parts=[];for(const n of names){const xml=await zip.file(n).async('string');parts.push(`[${n.split('/').pop().replace('.xml','')}] ${cleanXmlText(xml)}`)}return parts.join('\n\n');
  }
  throw new Error('Unsupported document type.');
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  try{
    const form=await new Request('http://local',{method:'POST',headers:req.headers,body:req,duplex:'half'}).formData();
    const file=form.get('file');if(!file)return res.status(400).json({error:'DOCUMENT_FILE_REQUIRED'});
    const ab=await file.arrayBuffer();if(ab.byteLength>4*1024*1024)return res.status(413).json({error:'Document is too large for direct Vercel processing in this preview (about 4 MB max).'});
    const text=(await extractDocumentBuffer(Buffer.from(ab),file.name||'document',file.type||'')).trim();
    if(!text)return res.status(422).json({error:'No readable text was found in this document.'});
    return res.status(200).json({text,fileName:file.name||'',type:extOf(file.name||'')});
  }catch(e){return res.status(400).json({error:e?.message||'Document extraction failed'});}
}
