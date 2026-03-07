import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://qxgefkohrgvewzpnigkf.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4Z2Vma29ocmd2ZXd6cG5pZ2tmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1MTE4NjQsImV4cCI6MjA4NzA4Nzg2NH0.EYt6jCDuuKm2rGadh8jyMW1S7AyzA7pjbM4mzBVIE0w'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)