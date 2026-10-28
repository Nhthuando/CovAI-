export const AI_MODELS = [
  {id:'gemini-3.5-flash-lite',name:'Gemini 3.5 Flash Lite',provider:'Google',badge:'Default',badgeColor:'#a78bfa',desc:'Gemini Flash Lite'},
  {id:'gemini-2.5-flash',name:'Gemini 2.5 Flash',provider:'Google',badge:'Flash',badgeColor:'#38bdf8',desc:'Gemini Flash'},
  {id:'gemini-3.1-flash-lite',name:'Gemini 3.1 Flash Lite',provider:'Google',badge:'Lite',badgeColor:'#4ade80',desc:'Gemini Flash Lite'},
  {id:'gemini-3.8-flash',name:'Gemini 3.8 Flash',provider:'Google',badge:'Flash',badgeColor:'#a78bfa',desc:'Gemini Flash'},
];
export const GEMINI_MODEL_IDS = AI_MODELS.map(model => model.id);
