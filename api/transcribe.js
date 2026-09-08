export const config={runtime:'edge'};
export default async function handler(request){
  if(request.method!=='POST') return new Response('Method not allowed',{status:405});
  try{
    const form=await request.formData();
    const file=form.get('file');
    const localKey=form.get('apiKey');
    const language=String(form.get('language')||'').trim();
    const contentType=String(form.get('contentType')||'').trim();
    const mediaKind=String(form.get('mediaKind')||'').trim();
    const key=process.env.GROQ_API_KEY || localKey;
    if(!key) return Response.json({error:'GROQ_API_KEY_REQUIRED'},{status:400});
    if(!file) return Response.json({error:'Audio file missing'},{status:400});
    const upstream=new FormData();upstream.append('file',file,file.name||'meeting.webm');const accuracyMode=mediaKind==='video'||contentType==='youtube'||contentType==='video';upstream.append('model',accuracyMode?'whisper-large-v3':'whisper-large-v3-turbo');upstream.append('response_format','verbose_json');upstream.append('temperature','0');if(language==='my'||language==='en')upstream.append('language',language);if(accuracyMode)upstream.append('prompt',language==='my'?'မြန်မာစကားကို အဓိပ္ပါယ်မပျက်အောင် တိတိကျကျ ရေးသားပါ။ အမည်၊ နံပါတ်၊ အင်္ဂလိပ်နည်းပညာစကားလုံးများကို မဖျက်ပါနှင့်။':'Transcribe accurately. Preserve names, numbers, and technical terms; do not paraphrase.');
    const r=await fetch('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${key}`},body:upstream});
    const data=await r.json();
    if(!r.ok) return Response.json({error:data?.error?.message||'Transcription failed'},{status:r.status});
    const text=String(data.text||'').trim();const words=text.split(/\s+/).filter(Boolean);const unique=new Set(words.map(w=>w.toLowerCase()));const repetition=words.length?1-(unique.size/words.length):1;const quality=(!text||text.length<12||repetition>0.85)?'poor':'ok';return Response.json({text,language:data.language||'',duration:data.duration||0,quality,model:accuracyMode?'whisper-large-v3':'whisper-large-v3-turbo'});
  }catch(e){return Response.json({error:e.message||'Transcription failed'},{status:500});}
}
