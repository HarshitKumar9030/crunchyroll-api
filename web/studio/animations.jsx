import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, MotionConfig, useReducedMotion } from 'framer-motion';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);
let dispose = () => {};
let collectionTween;

// The parent transition and child SVG animation have separate owners.
// Each route disposes both before replacing the page's DOM.
export function cleanupEnhancements() { collectionTween?.kill(); dispose(); dispose = () => {}; }

function useAnimationEnabled() {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return !reduced && visible;
}

function OrbitIllustration() {
  const moving = useAnimationEnabled();
  const spin = (seconds, reverse = false) => ({
    animate: { rotate: moving ? (reverse ? -360 : 360) : 0 },
    transition: moving ? { duration: seconds, repeat: Infinity, ease: 'linear' } : { duration: 0 },
  });
  return <motion.svg viewBox="0 0 440 310" className="orbit-svg" aria-hidden="true" initial={false}>
    <defs>
      <radialGradient id="orbit-glow"><stop stopColor="#f46735" stopOpacity=".12"/><stop offset="1" stopColor="#f46735" stopOpacity="0"/></radialGradient>
    </defs>
    <circle cx="220" cy="155" r="145" fill="url(#orbit-glow)"/>
    {[{angle:-28,duration:36},{angle:35,duration:42},{angle:97,duration:50}].map(({angle,duration},i)=><g key={angle} transform={`rotate(${angle} 220 155)`}>
      <motion.ellipse cx="220" cy="155" rx="132" ry="65" fill="none" stroke="var(--orbit-stroke)" strokeWidth=".8" initial={{pathLength:moving?0:1}} animate={{pathLength:1}} transition={{duration:moving?1.8:0,delay:moving?i*.12:0,ease:'easeInOut'}}/>
      <motion.g style={{transformOrigin:'220px 155px'}} {...spin(duration,i===1)}>
        <circle cx="352" cy="155" r={i===1?3:2.4} fill={i===1?'#f46735':'#8b9d7a'}/>
        {i===1&&<circle cx="352" cy="155" r="7" fill="none" stroke="#f46735" strokeOpacity=".25"/>}
      </motion.g>
    </g>)}
    <motion.circle cx="220" cy="155" r="23" fill="none" stroke="#f46735" strokeWidth=".8" animate={moving?{r:[18,31],opacity:[.35,0]}:{r:23,opacity:.25}} transition={{duration:moving?3:0,repeat:moving?Infinity:0,ease:'easeOut'}}/>
    <circle cx="220" cy="155" r="9" fill="#f46735"/>
    <circle cx="217" cy="152" r="2" fill="#ffc5a6"/>
    {[[85,74],[350,224],[330,62],[117,241]].map(([x,y],i)=><motion.g key={x} animate={moving?{opacity:[.25,.8,.25],scale:[.8,1,.8]}:{opacity:.6}} transition={{duration:moving?3+i:0,repeat:moving?Infinity:0,delay:moving?i*.6:0}} style={{transformOrigin:`${x}px ${y}px`}}><path d={`M${x-4} ${y}h8m-4-4v8`} stroke="#8c9c7d" strokeWidth="1"/></motion.g>)}
  </motion.svg>;
}

function DataFlow() {
  const moving = useAnimationEnabled();
  const nodes=[{x:28,title:'Your server',label:'credential boundary'},{x:228,title:'Crunchy API',label:'typed client'},{x:428,title:'Your next idea',label:'data, ready to build'}];
  return <svg viewBox="0 0 600 145" className="flow-svg" role="img" aria-label="Data flows from your server through the Crunchy API client to your application">
    {[0,1].map(i=><g key={i}><path d={`M${172+i*200} 63h56`} stroke="var(--line)" fill="none"/><motion.path d={`M${172+i*200} 63h56`} stroke="#f46735" strokeWidth="2" strokeDasharray="5 9" animate={moving?{strokeDashoffset:[28,0]}:{strokeDashoffset:0}} transition={{duration:moving?1.8:0,repeat:moving?Infinity:0,ease:'linear'}}/></g>)}
    {nodes.map(({x,title,label},i)=><motion.g key={title} initial={{opacity:moving?0:1,y:moving?5:0}} animate={{opacity:1,y:0}} transition={{duration:moving?.5:0,delay:moving?i*.15:0}}><rect x={x} y="34" width="144" height="58" rx="8" fill="var(--panel)" stroke={i===1?'#f46735':'var(--line)'}/><text x={x+72} y="68" textAnchor="middle" fill="var(--ink)" fontSize="12" fontFamily="DM Sans,sans-serif">{title}</text><text x={x+72} y="116" textAnchor="middle" fill="var(--muted)" fontSize="9" fontFamily="monospace">{label}</text></motion.g>)}
  </svg>;
}

export function mountEnhancements() {
  cleanupEnhancements();
  const roots=[];
  for(const element of document.querySelectorAll('[data-motion-orbit], [data-motion-flow]')) {
    const root=createRoot(element);
    root.render(<MotionConfig reducedMotion="user">{element.hasAttribute('data-motion-orbit')?<OrbitIllustration/>:<DataFlow/>}</MotionConfig>);
    roots.push(root);
  }
  const media=gsap.matchMedia();
  const abort=new AbortController();
  media.add('(prefers-reduced-motion: no-preference)',()=>{
    const main=document.querySelector('main');
    const lead=main.querySelectorAll('.breadcrumb, .eyebrow, .hero h1, .page-title, .hero p, .lede, .hero-actions, .hero-note');
    gsap.from(lead,{y:14,opacity:0,duration:.65,stagger:.055,ease:'power3.out',clearProps:'transform,opacity'});
    const orbital=main.querySelector('.orbital');
    if(orbital){
      gsap.from(orbital,{scale:.96,opacity:0,duration:1.05,ease:'power3.out',clearProps:'transform,opacity'});
      gsap.from(orbital.querySelectorAll('.floating'),{y:12,opacity:0,duration:.9,stagger:.15,delay:.45,ease:'power3.out',clearProps:'transform,opacity'});
    }
    main.querySelectorAll('.feature-grid, .two-col, .article>section, .playground, .settings-grid, .anime-list').forEach(section=>{
      gsap.from(section,{y:16,opacity:0,duration:.65,ease:'power2.out',scrollTrigger:{trigger:section,start:'top 94%',once:true},clearProps:'transform,opacity'});
    });
    return ()=>{};
  });
  const hoverTweens=new Set();
  function hover(event){
    if(matchMedia('(prefers-reduced-motion: reduce)').matches||!matchMedia('(hover: hover)').matches)return;
    const card=event.target.closest('.feature, .button, .brand-mark');
    if(!card||card.contains(event.relatedTarget))return;
    const entering=event.type==='pointerover';
    const tween=gsap.to(card,{y:entering?-2:0,duration:.3,ease:'power2.out',overwrite:true,onComplete:()=>hoverTweens.delete(tween)});
    hoverTweens.add(tween);
  }
  document.addEventListener('pointerover',hover,{signal:abort.signal});
  document.addEventListener('pointerout',hover,{signal:abort.signal});
  dispose=()=>{
    abort.abort();
    media.revert();
    for(const tween of hoverTweens)tween.revert();
    for(const root of roots)root.unmount();
  };
}

export function animateCollection() {
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  collectionTween?.kill();
  collectionTween = gsap.fromTo('.anime-row',{opacity:0,y:6},{opacity:1,y:0,duration:.32,stagger:.035,ease:'power2.out',overwrite:true,clearProps:'opacity,transform'});
}
