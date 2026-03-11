-- Plura Complete Supabase Schema
-- Run this script in your Supabase SQL Editor.

-- 1. Enable UUID Extension (usually enabled by default in Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgvector plugin
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create Custom ENUMs
CREATE TYPE chat_role AS ENUM ('user', 'assistant', 'system');
CREATE TYPE ai_provider AS ENUM ('ollama', 'openai', 'comfyui', 'vllm', 'custom');
CREATE TYPE user_role AS ENUM ('user', 'admin');
CREATE TYPE session_type AS ENUM ('chat', 'image_generation', 'text_to_speech');

-- 3. Profiles Table (Extended User Data)
-- Links to auth.users and stores explicit roles
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role DEFAULT 'user' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- Function to automatically create a profile for new users
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, role)
  VALUES (new.id, 'user');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger the function every time a user is created
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 4. Admin Settings Table
-- Stores global configuration like API endpoints for 'ollama', 'vllm', etc.
-- Only accessible to admins.
CREATE TABLE public.admin_settings (
    key VARCHAR(255) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- 5. Threads Table (Conversations)
-- A user can have multiple threads. 
-- We link it to auth.users (the built-in Supabase authentication table).
CREATE TABLE public.threads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title VARCHAR(255) DEFAULT 'New Conversation',
    session_type session_type NOT NULL DEFAULT 'chat',
    model VARCHAR(255),
    messages JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- Index for fast lookup of a user's threads
CREATE INDEX idx_threads_user_id ON public.threads(user_id);

-- 5. Documents Table
-- Stores references to user-uploaded files for the context.
CREATE TABLE public.documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    storage_path TEXT NOT NULL, -- Path in the 'documents' Supabase Storage Bucket
    size BIGINT,
    content_type TEXT,
    extracted_text TEXT, -- Cached text extracted from the document
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- Index for fetching a user's documents
CREATE INDEX idx_documents_user_id ON public.documents(user_id);

-- 5.1 Document Chunks Table
-- Stores chunks of text and their embeddings tied to a document
CREATE TABLE public.document_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding vector, -- Size is determined dynamically by the model
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- Index for fetching a document's chunks
CREATE INDEX idx_document_chunks_document_id ON public.document_chunks(document_id);

-- Match Document Chunks Function for Similarity Search
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector,
  match_count int DEFAULT 5,
  filter_document_ids uuid[] DEFAULT '{}'
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  content text,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.document_id,
    dc.content,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM public.document_chunks dc
  INNER JOIN public.documents d ON d.id = dc.document_id
  WHERE
    d.user_id = auth.uid()
    AND (array_length(filter_document_ids, 1) IS NULL OR dc.document_id = ANY(filter_document_ids))
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 5. Images Table
-- Stores references to AI-generated images, linked to a user.
CREATE TABLE public.images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    seed BIGINT,
    parameters JSONB, -- ComfyUI generation metadata (model, steps, cfg, aspect_ratio, etc.)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX idx_images_user_id ON public.images(user_id);

-- 6. Audio Table
-- Stores references to AI-generated audio (TTS, music, etc.), linked to a user.
CREATE TABLE public.audio (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    parameters JSONB, -- Generation metadata (model, seed, duration, etc.)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX idx_audio_user_id ON public.audio(user_id);

-- 7. User Capabilities Table
-- Stores which AI tool capabilities are enabled per user.
CREATE TABLE public.user_capabilities (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    capability_id TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
    PRIMARY KEY (user_id, capability_id)
);

ALTER TABLE public.user_capabilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own capabilities"
ON public.user_capabilities FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 6. Setup the Unified Storage Bucket
-- Creates a single PRIVATE bucket named 'library' for all user assets (audio, images, uploads)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('library', 'library', false)
ON CONFLICT (id) DO NOTHING;

-- 7. Basic Row Level Security (RLS) Policies
-- Secure the tables so users can only access their own data.

ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Threads RLS
CREATE POLICY "Users can view their own threads" 
ON public.threads FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own threads" 
ON public.threads FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own threads" 
ON public.threads FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own threads" 
ON public.threads FOR DELETE USING (auth.uid() = user_id);

-- Documents RLS
CREATE POLICY "Users can view their own documents" 
ON public.documents FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own documents" 
ON public.documents FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own documents" 
ON public.documents FOR DELETE USING (auth.uid() = user_id);

-- Images RLS
CREATE POLICY "Users can view their own images"
ON public.images FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own images"
ON public.images FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own images"
ON public.images FOR DELETE USING (auth.uid() = user_id);

-- Audio RLS
CREATE POLICY "Users can view their own audio"
ON public.audio FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own audio"
ON public.audio FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own audio"
ON public.audio FOR DELETE USING (auth.uid() = user_id);

-- Document Chunks RLS
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own document chunks" 
ON public.document_chunks FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = document_chunks.document_id AND d.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert their own document chunks" 
ON public.document_chunks FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = document_chunks.document_id AND d.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete their own document chunks" 
ON public.document_chunks FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = document_chunks.document_id AND d.user_id = auth.uid()
  )
);

-- Storage Policies for Unified 'library' Bucket
-- 1. Users can view their own files (Isolated by folder name)
CREATE POLICY "Private Library Viewing"
ON storage.objects FOR SELECT
USING (
    bucket_id = 'library' 
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND auth.role() = 'authenticated'
);

-- 2. Users can only upload to their own folder: userId/
CREATE POLICY "Users can upload to their own library folder"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'library' 
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND auth.role() = 'authenticated'
);

-- 3. Users can only update their own files
CREATE POLICY "Users can update their own library files"
ON storage.objects FOR UPDATE
USING (
    bucket_id = 'library' 
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND auth.uid() = owner
);

-- 4. Users can only delete their own files
CREATE POLICY "Users can delete their own library files"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'library' 
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND auth.uid() = owner
);

-- Profiles & Admin Settings RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can view their own profile. For a simple app, we can allow everyone to view profiles to avoid recursion.
CREATE POLICY "Users can view own profile" 
ON public.profiles FOR SELECT USING (auth.uid() = id);

-- Alternatively, allow all authenticated users to read profiles
CREATE POLICY "Authenticated users can read all profiles" 
ON public.profiles FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can update profiles" 
ON public.profiles FOR UPDATE USING (
    -- To avoid recursion, we check if the current user's role is admin from a direct query without the policy
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);

-- Admin Settings: Anyone authenticated can read (if you need client access), but only admins can write.
-- If settings are purely backend, you might limit SELECT to admins too.
CREATE POLICY "Authenticated users can read settings" 
ON public.admin_settings FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage settings" 
ON public.admin_settings FOR ALL USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);
