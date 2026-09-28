import React from 'react';
import {Search, UserRound, ShoppingBag, Menu, X, ChevronRight, Heart, Gift, Camera, CakeSlice, Sparkles, Truck, ShieldCheck, Headphones, ArrowRight, Minus, Plus, Trash2, CheckCircle2, Clock3, PackageCheck, MapPin, Phone, Mail, Upload, Image as ImageIcon, FolderPlus, Settings, Download, Eye, LogOut} from 'lucide-react';

export const money=n=>`₹${Number(n||0).toLocaleString('en-IN')}`;
export function CategoryIcon({type,size=27}){const I=type==='camera'?Camera:type==='heart'?Heart:type==='sparkles'?Sparkles:type==='candle'?CakeSlice:type==='bag'?ShoppingBag:Gift;return <I size={size}/>}
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Today's date in India plus N days, as YYYY-MM-DD (matches the database check in place_order).
export function istDate(offsetDays = 0) {
  const [y, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}
export const fmtDate = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const priceLabel = (p) => (p.priceMax > p.price ? `${money(p.price)} – ${money(p.priceMax)}` : money(p.price));
export const hasVariablePrice = (items) => items.some((i) => i.priceMax > i.price || i.priceNote);
export function Field({ label, error, hint, children, className }) {
  return (
    <label className={[className, error ? 'hasError' : ''].filter(Boolean).join(' ') || undefined}>
      {label}
      {children}
      {hint && !error && <small className="fieldHint">{hint}</small>}
      {error && <small className="fieldError" role="alert">{error}</small>}
    </label>
  );
}
export const focusFirstError = (errors) => {
  const k = Object.keys(errors).find((x) => errors[x]);
  if (k) document.querySelector(`[name="${k}"]`)?.focus();
};
