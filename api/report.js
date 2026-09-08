export const config={maxDuration:60};

const DEFAULT_MODELS=['gemini-3.6-flash','gemini-3.5-flash'];
const RETRYABLE_STATUSES=new Set([400,403,404,429,500,502,503,504]);

function modelList(){
  const configured=(process.env.GEMINI_MODEL||'').trim();
  return [...new Set([configured,...DEFAULT_MODELS].filter(Boolean))];
}

function extractText(data){
  return data?.candidates?.[0]?.content?.parts?.map(p=>p?.text||'').join('').trim()||'';
}

function cleanJsonText(text){
  return String(text||'').replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/```$/,'').trim();
}

function parseReport(text){
  const cleaned=cleanJsonText(text);
  if(!cleaned) throw new Error('EMPTY_REPORT');
  const report=JSON.parse(cleaned);
  if(!report || typeof report!=='object' || Array.isArray(report)) throw new Error('INVALID_REPORT');
  return report;
}

function buildPrompt({transcript,language,title,markers,contentType='meeting',detailLevel='standard',verifiedContext=''}){
  const isBurmese=language==='my';
  const outputLanguage=isBurmese?'Burmese (Myanmar language)':'English';
  const depth=detailLevel==='quick'?'QUICK SUMMARY':detailLevel==='deep'?'DEEP ANALYSIS':detailLevel==='auto'?'AUTO AI':'STANDARD REPORT';
  const missing=isBurmese?'မဖော်ပြထားပါ':'Not specified';
  const markerText=Array.isArray(markers)&&markers.length?markers.join(', '):'none';
  return `You are a senior AI content analyst. First perform a context analysis of this ${contentType} source, then create a ${depth}.
If this is YouTube/Video content, identify the real topic, main arguments, explanations and conclusion.
CLEANING AND CONTEXT ANALYSIS STAGE:
1. Identify the true topic before writing the report.
2. Separate meaningful content from speech-to-text noise.
3. Preserve names, numbers, dates, technical terms and key claims.
4. If YouTube/Video content, analyze the creator's main message, explanations, evidence and conclusion.
5. If transcript information is unclear, mark it as unclear.
6. Never fill missing information with assumptions.

FINAL REPORT RULE:
Clean obvious transcription errors. Do not invent facts.\n\nOUTPUT LANGUAGE RULE — MANDATORY:\nWrite ALL natural-language report content in ${outputLanguage}, regardless of the source/input language. Proper names, product names, technical terms, codes, and numbers may stay unchanged when appropriate. Do not mix languages unless needed for a proper noun or technical term.\n\nACCURACY RULES:\n- Do not invent facts.\n- If an owner, deadline, participant, number, decision, risk, or next step is not stated, use "${missing}" rather than guessing.\n- Preserve names, dates, quantities, and technical terms accurately.\n\nReturn ONLY valid JSON with this exact shape and no markdown fences:\n{"title":"...","executiveSummary":"...","keyPoints":["..."],"decisions":["..."],"actions":[{"action":"...","owner":"...","deadline":"..."}],"risks":["..."],"facts":["..."],"unresolved":["..."],"nextSteps":["..."],"importantMoments":["..."]}\n\nContent type: ${contentType}\nMeeting title hint: ${title||'none'}\nMarked timestamps: ${markerText}\n\n${verifiedContext?`\nVERIFIED CONTEXT (use this as the truth anchor; do not contradict it):\n${verifiedContext}\n`:''}\nSOURCE / TRANSCRIPT:\n${transcript}`;
}

async function callGemini({model,key,prompt,timeoutMs=24000}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
      method:'POST',
      headers:{'content-type':'application/json','x-goog-api-key':key},
      body:JSON.stringify({
        contents:[{role:'user',parts:[{text:prompt}]}],
        generationConfig:{temperature:0.2,responseMimeType:'application/json'}
      }),
      signal:controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}


function needsVerification(contentType='meeting'){return ['youtube','video','lecture'].includes(String(contentType).toLowerCase())}
function verificationPrompt(transcript,contentType){return `You are verifying a speech transcript before summarization. Source type: ${contentType}.
Return ONLY valid JSON with: {"topic":"","mainMessage":"","keyClaims":[""],"namesNumbersTerms":[""],"unclear":[""],"confidence":0}.
Rules: infer only from the transcript; do not invent missing context; preserve Burmese meaning, names, numbers and technical terms; ignore obvious repeated speech-recognition noise. Confidence is 0-100.
TRANSCRIPT:
${transcript}`}
async function verifyTranscript({transcript,contentType,key}){
  const model=modelList()[0];
  const r=await callGemini({model,key,prompt:verificationPrompt(transcript,contentType),timeoutMs:22000});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) return {verifiedContext:'',confidence:null};
  const raw=cleanJsonText(extractText(data));
  try{const v=JSON.parse(raw);return {verifiedContext:JSON.stringify(v),confidence:Number(v.confidence)||0}}catch{return {verifiedContext:'',confidence:null}}
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const key=process.env.GEMINI_API_KEY || body.apiKey;
    if(!key) return res.status(400).json({error:'GEMINI_API_KEY_REQUIRED'});

    const language=body.language==='my'?'my':'en';
    const contentType=body.contentType||'meeting';
    let verifiedContext='',confidence=null;
    if(typeof body.transcript==='string'&&body.transcript.trim()&&needsVerification(contentType)){const v=await verifyTranscript({transcript:body.transcript.trim(),contentType,key});verifiedContext=v.verifiedContext;confidence=v.confidence;if(confidence!==null&&confidence<30)return res.status(422).json({error:'TRANSCRIPT_QUALITY_TOO_LOW',code:'TRANSCRIPT_QUALITY_TOO_LOW',confidence});}
    let prompt='';
    if(typeof body.transcript==='string' && body.transcript.trim()){
      prompt=buildPrompt({transcript:body.transcript.trim(),language,title:body.title||'',markers:body.markers||[],contentType,detailLevel:body.detailLevel||'standard',verifiedContext});
    }else if(typeof body.prompt==='string' && body.prompt.trim()){
      prompt=body.prompt.trim();
    }else{
      return res.status(400).json({error:'REPORT_SOURCE_REQUIRED'});
    }

    const attempts=[];
    for(const model of modelList()){
      let r;
      try{
        r=await callGemini({model,key,prompt});
      }catch(e){
        attempts.push({model,status:0,message:e?.name==='AbortError'?'Model request timed out':(e?.message||'Network error')});
        continue;
      }

      const data=await r.json().catch(()=>({}));
      if(r.ok){
        const text=extractText(data);
        try{
          const report=parseReport(text);
          return res.status(200).json({report,text,model,language,confidence});
        }catch(e){
          attempts.push({model,status:502,message:'Gemini returned invalid JSON'});
          continue;
        }
      }

      const message=data?.error?.message||`Gemini request failed (${r.status})`;
      attempts.push({model,status:r.status,message});
      if(RETRYABLE_STATUSES.has(r.status)) continue;
      return res.status(r.status).json({error:message,model,code:'GEMINI_REPORT_FAILED'});
    }

    const last=attempts.at(-1);
    return res.status(502).json({
      error:last?.message||'AI report generation failed after trying available Gemini models.',
      code:'GEMINI_REPORT_FAILED',
      attempts:attempts.map(x=>({model:x.model,status:x.status}))
    });
  }catch(e){
    return res.status(500).json({error:e?.message||'Report generation failed'});
  }
}
