import {useEffect,useRef,useState} from 'react';

type Props={label:string;side:'left'|'right';variable:string;min:number;max:number;target?:string};

export function ColumnResizer({label,side,variable,min,max,target}:Props){
 const drag=useRef<{x:number;width:number}|null>(null);
 const [dragging,setDragging]=useState(false);
 const [width,setWidth]=useState<number>();
 useEffect(()=>{
  if(!dragging)return;
  const {cursor,userSelect}=document.body.style;
  document.body.style.cursor='col-resize';document.body.style.userSelect='none';
  return()=>{document.body.style.cursor=cursor;document.body.style.userSelect=userSelect};
 },[dragging]);
 function panel(handle:HTMLElement){return target?handle.parentElement!.querySelector<HTMLElement>(target)!:handle.parentElement!}
 function update(handle:HTMLElement,value:number){
  const host=handle.parentElement!;
  const available=target?host.clientWidth:host.parentElement!.clientWidth;
  const next=Math.round(Math.max(min,Math.min(max,available-280,value)));
  host.style.setProperty(variable,`${next}px`);setWidth(next);
 }
 return <div className={`column-resizer column-resizer-${side}${dragging?' is-dragging':''}`} role="separator" aria-label={label} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={width} tabIndex={0}
  onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();drag.current={x:e.clientX,width:panel(e.currentTarget).getBoundingClientRect().width};e.currentTarget.setPointerCapture(e.pointerId);setDragging(true)}}
  onPointerMove={e=>{if(drag.current)update(e.currentTarget,drag.current.width+(e.clientX-drag.current.x)*(side==='right'?1:-1))}}
  onPointerUp={e=>{drag.current=null;setDragging(false);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}}
  onLostPointerCapture={()=>{drag.current=null;setDragging(false)}}
  onPointerCancel={()=>{drag.current=null;setDragging(false)}}
  onKeyDown={e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();update(e.currentTarget,panel(e.currentTarget).getBoundingClientRect().width+(e.key==='ArrowRight'?16:-16)*(side==='right'?1:-1))}}
  onDoubleClick={e=>{e.currentTarget.parentElement!.style.removeProperty(variable);setWidth(undefined)}}/>
}
