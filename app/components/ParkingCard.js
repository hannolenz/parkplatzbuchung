'use client';
import { useMemo, useState } from 'react';

const DEFAULT_PRIORITIES=['1181','1183','1185'];

export default function ParkingCard() {
  const [state,setState]=useState({status:'idle',message:'Bereit.'});
  const [date,setDate]=useState('');
  const [slot,setSlot]=useState('morning');
  const [priorities,setPriorities]=useState(DEFAULT_PRIORITIES.join(', '));
  const [fallback,setFallback]=useState(true);
  const [stations,setStations]=useState([]);
  const [suggested,setSuggested]=useState(null);
  const [checkedDate,setCheckedDate]=useState(null);

  const priorityList=useMemo(()=>priorities.split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean),[priorities]);

  function payload(extra={}) { return {date,slot,priorities:priorityList,fallback,...extra}; }

  async function testLogin(){
    setState({status:'working',message:'Login wird geprüft …'});
    try{
      const r=await fetch('/api/parking/login-test',{method:'POST'}); const d=await r.json();
      if(!r.ok||!d.ok) throw new Error(d.message||'Login-Test fehlgeschlagen.');
      setState({status:'success',message:'Login erfolgreich.'});
    }catch(e){setState({status:'error',message:e.message});}
  }

  async function checkAvailability(){
    if(!date){setState({status:'error',message:'Bitte zuerst ein Parkdatum auswählen.'});return;}
    setState({status:'working',message:`Verfügbarkeit für ${formatDate(date)} wird geprüft …`});
    setStations([]); setSuggested(null); setCheckedDate(null);
    try{
      const r=await fetch('/api/parking/availability',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload())});
      const d=await r.json(); if(!r.ok||!d.ok) throw new Error(d.message||'Prüfung fehlgeschlagen.');
      setStations(d.stations||[]); setSuggested(d.suggested||null); setCheckedDate(date);
      setState({status:'success',message:`${d.stations.filter(s=>s.free).length} freie Säulen am ${formatDate(date)} gefunden.`});
    }catch(e){setState({status:'error',message:e.message});}
  }

  async function reserve(){
    if(!suggested || checkedDate!==date){setState({status:'error',message:'Bitte die Verfügbarkeit für dieses Datum zuerst neu prüfen.'});return;}
    const text=`${formatDate(date)}, ${slot==='morning'?'07:00–12:30 Uhr':'13:00–15:00 Uhr'}, Säule ${suggested.number}`;
    if(!window.confirm(`Jetzt wirklich reservieren?\n\n${text}`)) return;
    setState({status:'working',message:`Reservierung für Säule ${suggested.number} wird ausgeführt …`});
    try{
      const r=await fetch('/api/parking/reserve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload({confirm:true,expectedStation:suggested.number}))});
      const d=await r.json(); if(!r.ok||!d.ok) throw new Error(d.message||'Reservierung fehlgeschlagen.');
      setState({status:'success',message:`Reserviert: ${formatDate(date)}, ${d.slotLabel}, Säule ${d.station}. ${d.verification}`});
      setSuggested(null); setStations([]);
    }catch(e){setState({status:'error',message:e.message});}
  }

  return <article className="card parkingCard wideCard">
    <div className="cardTop"><div className="iconBox">P</div><span className="moduleBadge">AKTIV</span></div>
    <h3>Parkplatz</h3><p>Das Parkdatum ist maßgeblich. Parkplatzbuchung sucht auf der ERGO-Seite automatisch den passenden Datumsreiter.</p>
    <div className="formGrid">
      <label>Parktag<input type="date" value={date} onChange={e=>{setDate(e.target.value);setSuggested(null);setStations([])}}/></label>
      <label>Zeitslot<select value={slot} onChange={e=>{setSlot(e.target.value);setSuggested(null);setStations([])}}>
        <option value="morning">07:00–12:30 Uhr</option><option value="afternoon">13:00–15:00 Uhr</option>
      </select></label>
    </div>
    <label className="field">Säulen-Priorität<input value={priorities} onChange={e=>{setPriorities(e.target.value);setSuggested(null)}}/><small>Kommagetrennt. Die erste freie Säule gewinnt.</small></label>
    <label className="checkRow"><input type="checkbox" checked={fallback} onChange={e=>{setFallback(e.target.checked);setSuggested(null)}}/> Andere freie Säule als Ersatz zulassen</label>
    <div className={`result ${state.status}`}><span className="dot"/><span>{state.message}</span></div>
    {stations.length>0&&<div className="availability"><strong>Auswahl für {formatDate(date)}</strong><span>{stations.filter(s=>s.free).length} von {stations.length} Säulen frei</span><div className="suggestion">{suggested?<>Vorgeschlagene Säule: <b>{suggested.number}</b></>:'Keine passende freie Säule gefunden.'}</div></div>}
    <div className="buttonRow three"><button className="secondaryButton" onClick={testLogin} disabled={state.status==='working'}>Login testen</button><button className="secondaryButton" onClick={checkAvailability} disabled={state.status==='working'}>Verfügbarkeit prüfen</button><button className="primaryButton" onClick={reserve} disabled={state.status==='working'||!suggested}>Jetzt reservieren</button></div>
    <p className="safeNote">Vor jeder echten Reservierung erscheint eine Bestätigung mit Datum, Zeitslot und Säule. Eine automatische zeitgesteuerte Buchung ist noch nicht eingerichtet.</p>
  </article>;
}
function formatDate(iso){if(!iso)return '–';const [y,m,d]=iso.split('-');return `${d}.${m}.${y}`;}
