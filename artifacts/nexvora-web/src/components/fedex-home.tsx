import { useState, type FormEvent } from 'react';
import { ArrowRight, ChevronDown, Globe2, Menu, Package, Search, ShieldCheck, Truck, X } from 'lucide-react';

const navItems = ['Shipping', 'Tracking', 'Design & Print', 'Locations', 'Support'];

export function FedExHome() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function handleTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (trackingNumber.trim()) setSubmitted(true);
  }

  return (
    <main className="fedex-page">
      <div className="fedex-alert"><span>Service updates</span> Check the latest shipping alerts and operational updates. <a href="#alerts">View alerts <ArrowRight size={14} /></a></div>
      <header className="fedex-header">
        <a className="fedex-logo" href="/" aria-label="FedEx home"><span>Fed</span><b>Ex</b></a>
        <nav className={menuOpen ? 'fedex-nav fedex-nav-open' : 'fedex-nav'} aria-label="Main navigation">
          {navItems.map((item) => <a href={`#${item.toLowerCase().replaceAll(' ', '-')}`} key={item}>{item} <ChevronDown size={14} /></a>)}
          <a className="fedex-nav-account" href="/login">Sign in <ArrowRight size={15} /></a>
        </nav>
        <div className="fedex-header-actions"><a className="fedex-country" href="#country"><Globe2 size={17} /> EN <ChevronDown size={13} /></a><button className="fedex-menu" type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'}>{menuOpen ? <X /> : <Menu />}</button></div>
      </header>

      <section className="fedex-hero">
        <div className="fedex-hero-copy"><p className="fedex-kicker">The world on your schedule</p><h1>Delivering what matters.</h1><p>From a single package to your entire supply chain, FedEx helps you move forward with confidence.</p><div className="fedex-hero-actions"><a className="fedex-button fedex-button-orange" href="#shipping">Ship now <ArrowRight size={17} /></a><a className="fedex-text-link" href="#services">Explore services <ArrowRight size={16} /></a></div></div>
        <div className="fedex-hero-art" aria-label="Stylized FedEx delivery van illustration"><div className="fedex-sun" /><div className="fedex-road" /><div className="fedex-van"><div className="van-cab" /><div className="van-box"><span>Fed</span><b>Ex</b></div><div className="van-wheel van-wheel-one" /><div className="van-wheel van-wheel-two" /></div><div className="fedex-route route-one" /><div className="fedex-route route-two" /></div>
      </section>

      <section className="fedex-track-section" id="tracking"><div><p className="fedex-kicker">Track your shipment</p><h2>Where is your package?</h2><p>Enter up to 30 tracking numbers to get the latest updates.</p></div><form className="fedex-track-form" onSubmit={handleTrack}><label className="sr-only" htmlFor="tracking-number">Tracking number</label><div className="fedex-input-wrap"><Package size={19} /><input id="tracking-number" value={trackingNumber} onChange={(event) => { setTrackingNumber(event.target.value); setSubmitted(false); }} placeholder="Tracking number" /><button type="submit" aria-label="Track package"><Search size={19} /></button></div><a href="#advanced">Advanced tracking options <ArrowRight size={14} /></a>{submitted && <p className="fedex-success" role="status">Tracking request ready for {trackingNumber.trim()}.</p>}</form></section>

      <section className="fedex-services" id="services"><div className="fedex-section-heading"><div><p className="fedex-kicker">Built for your business</p><h2>Solutions that keep you moving</h2></div><a className="fedex-text-link" href="#all-services">View all services <ArrowRight size={16} /></a></div><div className="fedex-service-grid"><article><div className="fedex-icon"><Truck /></div><h3>Ship with FedEx</h3><p>Reliable delivery options for packages of every size, near and far.</p><a href="#shipping">Find the right service <ArrowRight size={15} /></a></article><article><div className="fedex-icon"><ShieldCheck /></div><h3>Protect your business</h3><p>Tools and insights to help your business stay ahead of what is next.</p><a href="#business">Explore business solutions <ArrowRight size={15} /></a></article><article><div className="fedex-icon"><Globe2 /></div><h3>Go further, globally</h3><p>Connect to customers around the world with international expertise.</p><a href="#international">Explore international shipping <ArrowRight size={15} /></a></article></div></section>

      <section className="fedex-promo" id="alerts"><div><p className="fedex-kicker">FedEx Delivery Manager</p><h2>More control over your deliveries.</h2><p>Get notifications, customize delivery times, and make every delivery fit your day.</p><a className="fedex-button fedex-button-purple" href="/signup">Sign up for free <ArrowRight size={17} /></a></div><div className="fedex-phone"><div className="phone-top" /><div className="phone-card"><div className="phone-line short" /><div className="phone-line" /><div className="phone-line" /><div className="phone-check">✓</div></div></div></section>
      <footer className="fedex-footer"><div className="fedex-logo"><span>Fed</span><b>Ex</b></div><div className="fedex-footer-links"><a href="#company">About FedEx</a><a href="#careers">Careers</a><a href="#privacy">Privacy & security</a><a href="#contact">Contact us</a></div><p>© 2026 FedEx. All rights reserved.</p></footer>
    </main>
  );
}
