import React from 'react';
import {Search, UserRound, ShoppingBag, Menu, X, ChevronRight, Heart, Gift, Camera, CakeSlice, Sparkles, Truck, ShieldCheck, Headphones, ArrowRight, Minus, Plus, Trash2, CheckCircle2, Clock3, PackageCheck, MapPin, Phone, Mail, Upload, Image as ImageIcon, FolderPlus, Settings, Download, Eye, LogOut} from 'lucide-react';

export const money=n=>`₹${Number(n||0).toLocaleString('en-IN')}`;
export function CategoryIcon({type,size=27}){const I=type==='camera'?Camera:type==='heart'?Heart:type==='sparkles'?Sparkles:type==='candle'?CakeSlice:type==='bag'?ShoppingBag:Gift;return <I size={size}/>}
