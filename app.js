(()=>{
'use strict';
const $=id=>document.getElementById(id);
const KEY_PROGRESS='ap-flashcards-progress-v2';
const KEY_DRAFT='ap-flashcards-deck-draft-v2';
const LEGACY_KEY='ap-kamoku-b-150-2026-v1';
const BACKUP_KIND='ap-flashcards-progress';
const DECK_ID='ap-kamoku-b';
const fields=['category','question','answer','explanation','point'];
const state={base:null,deck:null,draft:null,progress:{},storage:false,category:'ALL',mode:'ordered',current:null,answerShown:false,visibleIds:[],conflict:null};
const idIndex=()=>new Map(state.deck.cards.map((x,i)=>[x.id,i]));
const r=(id)=>state.progress[id]||{seen:false,correct:0,incorrect:0,needsReview:false};
const positive=(x)=>Number.isFinite(Number(x))?Math.max(0,Math.floor(Number(x))):0;
function cleanProgress(p){
  if(!p||typeof p!=='object'||Array.isArray(p))throw Error('学習記録が不正です');
  const out={};for(const [id,v] of Object.entries(p)){
    if(!/^[A-Za-z0-9_-]{1,64}$/.test(id)||!v||typeof v!=='object'||Array.isArray(v))continue;
    out[id]={seen:!!v.seen,correct:positive(v.correct??v.right),incorrect:positive(v.incorrect??v.wrong),needsReview:!!(v.needsReview??v.review)};
  }return out;
}
function validateDeck(raw){
  if(!raw||typeof raw!=='object'||raw.deckId!==DECK_ID||!Array.isArray(raw.cards)||!Array.isArray(raw.archivedCards))throw Error('この単語帳に対応しないJSONです');
  if(!Array.isArray(raw.categories)||raw.categories.some(c=>typeof c!=='string'||!c.trim()))throw Error('分野の設定が不正です');
  if(raw.cards.length+raw.archivedCards.length>10000)throw Error('問題数が多すぎます');
  const seen=new Set(),categories=new Set(raw.categories);
  const validateCard=c=>{
    if(!c||typeof c!=='object'||typeof c.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(c.id)||seen.has(c.id))throw Error('重複または不正な問題IDです');
    seen.add(c.id);
    if(!categories.has(c.category)||typeof c.question!=='string'||!c.question.trim()||typeof c.answer!=='string'||!c.answer.trim())throw Error('問題文・正答・分野が不正です');
    for(const f of ['explanation','point'])if(c[f]!=null&&typeof c[f]!=='string')throw Error('解説・ポイントが不正です');
    return {...c};
  };
  const cards=raw.cards.map(validateCard),archivedCards=raw.archivedCards.map(validateCard);
  const retiredIds=Array.isArray(raw.retiredIds)?raw.retiredIds:[];
  for(const id of retiredIds){if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(id)||seen.has(id))throw Error('完全削除した問題IDが不正または重複しています');seen.add(id);}
  const numericIds=[...seen].filter(x=>/^\d+$/.test(x)).map(Number);
  const minNext=Math.max(1,...numericIds,0)+1;
  return {schemaVersion:2,deckId:DECK_ID,title:String(raw.title||'応用情報 科目B 単語帳'),description:String(raw.description||''),revision:String(raw.revision||''),nextId:Math.max(minNext,positive(raw.nextId)||1),categories:[...raw.categories],cards,archivedCards,retiredIds:[...retiredIds]};
}
function showAlert(id,message){$(id).textContent=message;$(id).classList.remove('hidden');}
function clearAlert(id){$(id).classList.add('hidden');$(id).textContent='';}
function store(key,value){if(!state.storage)return false;try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{state.storage=false;updateSaveNotice();return false;}}
function read(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
function updateSaveNotice(){
 const txt=state.storage?'✓ 学習記録と端末の編集内容はこのブラウザ内に保存されます。定期的にJSONバックアップを取ってください。':'⚠ この表示環境では自動保存できません。必ずJSONを書き出してください。';
 $('saveNotice').textContent=txt;$('saveNotice').className='alert '+(state.storage?'note':'warning');
}
function setDraft(deck){
 state.deck=validateDeck(deck);
 state.draft={baseRevision:state.base.revision,deck:state.deck};
 store(KEY_DRAFT,state.draft);
 updateView();
}
function updateDraftNotice(){
 $('draftStatus').textContent=state.draft?'この端末で編集した下書きを使用中（未公開）':'GitHub公開版を使用中';
 $('archivedCount').textContent='削除済み保管：'+state.deck.archivedCards.length+'問';
}
function getPool(){return state.deck.cards.filter(c=>(state.category==='ALL'||c.category===state.category)&&(state.mode==='missed'?r(c.id).needsReview:state.mode==='new'?!r(c.id).seen:true)).map(c=>c.id);}
function chooseRandom(ids,exclude){const eligible=ids.length>1?ids.filter(id=>id!==exclude):ids;return eligible[Math.floor(Math.random()*eligible.length)]||null;}
function nextCard(step=1,wasGraded=false){
 const pool=getPool();if(!pool.length){state.current=null;render();return;}
 const previous=state.current,order=state.deck.cards.map(c=>c.id);
 if(state.mode==='random'){state.current=chooseRandom(pool,previous)}
 else if(pool.includes(previous)&&!wasGraded){state.current=pool[(pool.indexOf(previous)+step+pool.length)%pool.length]}
 else{
   const prevIndex=order.indexOf(previous);
   if(prevIndex<0)state.current=pool[0];
   else{
     const ordered=step>0?pool.find(id=>order.indexOf(id)>prevIndex):[...pool].reverse().find(id=>order.indexOf(id)<prevIndex);
     state.current=ordered||(step>0?pool[0]:pool[pool.length-1]);
   }
 }
 state.answerShown=false;render();
}
function resetSelection(){const pool=getPool();state.current=state.mode==='random'?chooseRandom(pool):pool[0]||null;state.answerShown=false;render();}
function renderStats(){
 const cards=state.deck.cards;
 let studied=0,correct=0,wrong=0,missed=0;
 for(const c of cards){const x=r(c.id);studied+=x.seen?1:0;correct+=positive(x.correct);wrong+=positive(x.incorrect);missed+=x.needsReview?1:0;}
 $('sTotal').textContent=String(cards.length);$('deckCount').textContent='全'+cards.length+'問';$('sStudied').textContent=String(studied);
 $('sCorrect').textContent=String(correct);$('sWrong').textContent=String(wrong);$('sMissed').textContent=String(missed);
 $('sAccuracy').textContent=correct+wrong?(correct/(correct+wrong)*100).toFixed(1)+'%':'—';
}
function render(){
 renderStats();const pool=getPool();state.visibleIds=pool;
 if(!pool.includes(state.current)){state.current=pool[0]||null;state.answerShown=false;}
 const card=state.deck.cards.find(x=>x.id===state.current),has=!!card;
 $('card').classList.toggle('hidden',!has);$('emptyMessage').classList.toggle('hidden',has);
 $('questionIndex').textContent=has?'Q'+card.id:'該当0問';
 $('progressText').textContent=has?`${pool.indexOf(card.id)+1} / ${pool.length}`:'0 / 0';
 $('progressBar').style.width=has?(100*(pool.indexOf(card.id)+1)/pool.length).toFixed(2)+'%':'0%';
 if(has){
   $('cardCategory').textContent=card.category;$('questionText').textContent=card.question;
   $('answerText').textContent=card.answer;$('explanationText').textContent=card.explanation||'';
   $('pointText').textContent=card.point?'試験対策：'+card.point:'';
   $('answerArea').classList.toggle('hidden',!state.answerShown);
   $('cardSide').textContent=state.answerShown?'裏面・正答':'表面・問題';
   $('tapHelp').textContent=state.answerShown?'タップして問題に戻る':'タップして答えを表示';
   $('showBtn').textContent=state.answerShown?'問題に戻す':'答えを見る';
 }
 for(const id of ['wrongBtn','correctBtn'])$(id).disabled=!(has&&state.answerShown);
 for(const id of ['skipBtn','prevBtn','nextBtn','showBtn'])$(id).disabled=!has;
}
function toggleAnswer(){if(!state.current)return;state.answerShown=!state.answerShown;render();}
function grade(kind){if(!state.current||!state.answerShown)return;const id=state.current,x=r(id);state.progress[id]={seen:true,correct:positive(x.correct)+(kind==='correct'?1:0),incorrect:positive(x.incorrect)+(kind==='wrong'?1:0),needsReview:kind==='wrong'};store(KEY_PROGRESS,state.progress);nextCard(1,true);}
function fillFilters(){
 const currentCategory=state.category;
 $('categoryFilter').replaceChildren(new Option('全分野','ALL'),...state.deck.categories.map(c=>new Option(c+'（'+state.deck.cards.filter(x=>x.category===c).length+'問）',c)));
 $('categoryFilter').value=state.deck.categories.includes(currentCategory)?currentCategory:'ALL';state.category=$('categoryFilter').value;
 $('editCategory').replaceChildren(...state.deck.categories.map(c=>new Option(c,c)));
}
function updateView(){fillFilters();updateDraftNotice();resetSelection();renderManageList();}
function fileDownload(obj,name){
 const url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)+'\n'],{type:'application/json;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function exportProgress(){fileDownload({type:BACKUP_KIND,version:2,deckId:DECK_ID,exportedAt:new Date().toISOString(),progress:state.progress},'ap-flashcards-progress.json')}
function importProgress(file){
 if(!file)return;file.text().then(txt=>{
  const obj=JSON.parse(txt);let progress;
  if(obj.type===BACKUP_KIND&&obj.deckId===DECK_ID)progress=cleanProgress(obj.progress);
  else if(obj.type==='ap-kamokuB-150-progress')progress=cleanProgress(obj.ratings);
  else throw Error('対応しない学習記録ファイルです');
  if(confirm('現在の学習記録を読み込んだ内容で置き換えますか？')){state.progress=progress;store(KEY_PROGRESS,progress);resetSelection();alert('学習記録を復元しました。');}
 }).catch(e=>alert('学習記録の読み込みに失敗しました：'+e.message));
}
function exportDeck(){const deck={...state.deck,revision:new Date().toISOString()};fileDownload(deck,'questions.json');}
function importDeck(file){
 if(!file)return;file.text().then(txt=>{
  const candidate=validateDeck(JSON.parse(txt));
  if(!confirm(`問題データを ${candidate.cards.length}問に置き換えますか？\n現在の問題データは自動保存されません。事前の書き出しをおすすめします。\n学習記録は問題IDに紐付いたまま維持します。`))return;
  setDraft(candidate);alert('端末上の問題データを更新しました。全端末への公開はGitHubのquestions.jsonを更新してください。');
 }).catch(e=>alert('問題データの読み込みに失敗しました：'+e.message));
}
function renderManageList(){
 const q=$('manageSearch').value.trim().toLowerCase();
 const sorted=state.deck.cards.filter(c=>!q||[c.id,c.category,c.question,c.answer].join(' ').toLowerCase().includes(q));
 const makeRow=(c,archived)=>{
   const row=document.createElement('div');row.className='manageRow';
   const title=document.createElement('div');title.className='manageText';
   const strong=document.createElement('strong');strong.textContent='Q'+c.id+' ｜ '+c.category;
   const p=document.createElement('div');p.textContent=c.question;title.append(strong,p);row.append(title);
   const buttons=document.createElement('div');buttons.style.display='flex';buttons.style.gap='5px';
   if(archived){const restore=document.createElement('button');restore.type='button';restore.textContent='復元';restore.addEventListener('click',()=>restoreCard(c.id));const hard=document.createElement('button');hard.type='button';hard.className='danger';hard.textContent='完全削除';hard.addEventListener('click',()=>purgeCard(c.id));buttons.append(restore,hard)}
   else{
     const edit=document.createElement('button');edit.type='button';edit.textContent='編集';edit.addEventListener('click',()=>showEditor(c));
     const del=document.createElement('button');del.type='button';del.textContent='削除';del.className='danger';del.addEventListener('click',()=>deleteCard(c.id));buttons.append(edit,del);
   }row.append(buttons);return row;
 };
 const rows=sorted.slice(0,50).map(c=>makeRow(c,false));
 $('manageList').replaceChildren(...rows);
 if(sorted.length>50){const small=document.createElement('p');small.className='small';small.textContent=`検索結果 ${sorted.length}問のうち50問を表示しています。絞り込んでください。`;$('manageList').append(small)}
 const archive=state.deck.archivedCards.filter(c=>!q||[c.id,c.question,c.answer].join(' ').toLowerCase().includes(q));
 $('archiveList').replaceChildren(...archive.map(c=>makeRow(c,true)));
 if(!archive.length){const p=document.createElement('p');p.className='small';p.textContent='該当する削除済み問題はありません。';$('archiveList').append(p)}
}
function showEditor(card=null){
 $('editId').value=card?.id||'';$('editorTitle').textContent=card?'Q'+card.id+' を編集':'新しい問題を追加';
 for(const field of fields){const key='edit'+field.charAt(0).toUpperCase()+field.slice(1);$(key).value=card?.[field]||'';}
 $('editorForm').classList.remove('hidden');$('editorForm').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function hideEditor(){$('editorForm').classList.add('hidden');$('editorForm').reset();}
function submitEditor(event){
 event.preventDefault();const id=$('editId').value.trim();
 const data={};for(const field of fields){const key='edit'+field.charAt(0).toUpperCase()+field.slice(1);data[field]=$(key).value.trim();}
 if(!data.question||!data.answer||!state.deck.categories.includes(data.category)){alert('分野・問題文・正答を入力してください。');return}
 const normalized=s=>s.replace(/\s+/g,'').toLowerCase();
 if(state.deck.cards.some(x=>x.id!==id&&x.category===data.category&&normalized(x.question)===normalized(data.question))){alert('同じ分野に同じ問題文があります。重複を確認してください。');return}
 const deck=structuredClone(state.deck);
 if(id){const idx=deck.cards.findIndex(c=>c.id===id);if(idx<0)return;deck.cards[idx]={...deck.cards[idx],...data};}
 else{const newId=String(deck.nextId).padStart(3,'0');deck.nextId+=1;deck.cards.push({id:newId,section_no:deck.nextId-1,...data,origin:'手動追加（ユーザー編集）'});}
 setDraft(deck);hideEditor();
}
function deleteCard(id){const card=state.deck.cards.find(c=>c.id===id);if(!card)return;
 if(!confirm(`Q${id}「${card.question}」を出題対象から外しますか？\n問題は削除済み一覧に保管され、後から復元できます。学習記録も残ります。`))return;
 const deck=structuredClone(state.deck);deck.cards=deck.cards.filter(c=>c.id!==id);deck.archivedCards.push(card);setDraft(deck);
}
function restoreCard(id){const c=state.deck.archivedCards.find(c=>c.id===id);if(!c)return;
 const deck=structuredClone(state.deck);deck.archivedCards=deck.archivedCards.filter(c=>c.id!==id);deck.cards.push(c);
 // Restore the original numeric card sequence, including older IDs.
 deck.cards.sort((a,b)=>Number(a.id)-Number(b.id));setDraft(deck);
}
function purgeCard(id){const c=state.deck.archivedCards.find(c=>c.id===id);if(!c)return;
 if(!confirm(`Q${id}を完全削除しますか？\n問題文・正答を問題データから除き、復元できなくなります。学習履歴はブラウザ内に残ります。`))return;
 const deck=structuredClone(state.deck);deck.archivedCards=deck.archivedCards.filter(c=>c.id!==id);deck.retiredIds.push(id);setDraft(deck);
}
function discardDraft(){if(!state.draft)return;
 if(!confirm('この端末で編集した問題データを破棄し、GitHub公開版に戻しますか？ 学習記録は残ります。'))return;
 state.draft=null;state.deck=structuredClone(state.base);if(state.storage)localStorage.removeItem(KEY_DRAFT);clearAlert('syncNotice');hideEditor();updateView();
}
function initHandlers(){
 $('card').addEventListener('click',toggleAnswer);
 $('card').addEventListener('keydown',e=>{if(e.target===$('card')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();toggleAnswer()}});
 $('showBtn').addEventListener('click',toggleAnswer);
 $('correctBtn').addEventListener('click',()=>grade('correct'));
 $('wrongBtn').addEventListener('click',()=>grade('wrong'));
 $('skipBtn').addEventListener('click',()=>nextCard());
 $('nextBtn').addEventListener('click',()=>nextCard());
 $('prevBtn').addEventListener('click',()=>nextCard(-1));
 $('categoryFilter').addEventListener('change',e=>{state.category=e.target.value;resetSelection()});
 $('modeFilter').addEventListener('change',e=>{state.mode=e.target.value;resetSelection()});
 $('exportProgress').addEventListener('click',exportProgress);
 $('importProgress').addEventListener('change',e=>{importProgress(e.target.files[0]);e.target.value=''});
 $('resetProgress').addEventListener('click',()=>{if(confirm('正誤・学習済み・復習対象をすべてリセットしますか？')){state.progress={};store(KEY_PROGRESS,state.progress);resetSelection()}});
 $('addCard').addEventListener('click',()=>showEditor());$('exportDeck').addEventListener('click',exportDeck);
 $('importDeck').addEventListener('change',e=>{importDeck(e.target.files[0]);e.target.value=''});
 $('discardDraft').addEventListener('click',discardDraft);
 $('manageSearch').addEventListener('input',renderManageList);
 $('editorForm').addEventListener('submit',submitEditor);
 $('cancelEdit').addEventListener('click',hideEditor);
}
async function init(){
 try{
  const res=await fetch('questions.json',{cache:'no-store'});
  if(!res.ok)throw Error('HTTP '+res.status);
  state.base=validateDeck(await res.json());
  state.deck=structuredClone(state.base);
  try{
   const probe='ap-flashcards-probe';localStorage.setItem(probe,'ok');state.storage=localStorage.getItem(probe)==='ok';localStorage.removeItem(probe);
  }catch{state.storage=false}
  if(state.storage){
   const current=read(KEY_PROGRESS);let historical=current;
   if(!current){const legacy=read(LEGACY_KEY);if(legacy)historical=legacy}
   if(historical)state.progress=cleanProgress(historical);
   if(!current&&historical)store(KEY_PROGRESS,state.progress);
   const draft=read(KEY_DRAFT);
   if(draft&&draft.baseRevision&&draft.deck){
    try{
     const decoded=validateDeck(draft.deck);
     if(JSON.stringify([decoded.cards,decoded.archivedCards,decoded.retiredIds])===JSON.stringify([state.base.cards,state.base.archivedCards,state.base.retiredIds])){
      localStorage.removeItem(KEY_DRAFT);
     }else if(draft.baseRevision===state.base.revision){
      state.draft={baseRevision:draft.baseRevision,deck:decoded};state.deck=decoded;
     }else{
      state.conflict=draft;
      showAlert('syncNotice','GitHub公開版が更新されています。古い端末の下書きは自動適用せず保護しました。必要なら以前の問題データを保存してから、新しい公開版を編集してください。');
      const btn=document.createElement('button');btn.type='button';btn.textContent='古い下書きの問題データを保存';btn.style.marginLeft='8px';btn.onclick=()=>fileDownload(validateDeck(draft.deck),'questions-old-draft.json');$('syncNotice').append(btn);
     }
    }catch(e){showAlert('syncNotice','端末の問題下書きを読み込めませんでした：'+e.message)}
   }
  }
  updateSaveNotice();initHandlers();updateView();$('studyApp').classList.remove('hidden');
 }catch(error){
  console.error(error);
  showAlert('loadError','問題データを読み込めませんでした。HTMLを「ファイル」アプリで直接開くと正常に動作しない場合があります。index.html・app.js・styles.css・questions.jsonを同じGitHub Pagesリポジトリに置き、Safariで公開URLを開いてください。（'+error.message+'）');
  $('saveNotice').classList.add('hidden');
 }
}
init();
})();
