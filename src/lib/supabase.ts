import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase URL or Anon Key is missing in environment variables.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Product interface based on the Supabase data structure
export interface Product {
  id: string;
  content: string;
  metadata: {
    sku: string;
    url: string;
    tags: string[];
    type: string;
    price: number;
    title: string;
    handle: string;
    images: Array<{
      src: string;
      position: number;
    }>;
    vendor: string;
    available: boolean;
    image_url: string;
    price_max: number;
    price_min: number;
    variant_title?: string;
    compare_at_price?: number;
  };
  created_at: string;
  updated_at: string;
}
