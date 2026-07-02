-- ============================================================
-- Anime Streaming Platform - Supabase Database Schema
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. GENRES
CREATE TABLE genres (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL UNIQUE,
  slug VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_genres_slug ON genres(slug);

-- 2. ANIME SERIES
CREATE TABLE anime_series (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(500) NOT NULL,
  slug VARCHAR(500) NOT NULL UNIQUE,
  description TEXT,
  cover_image VARCHAR(1000),
  thumbnail VARCHAR(1000),
  rating DECIMAL(3,1) DEFAULT 0,
  release_year INTEGER,
  status VARCHAR(50) DEFAULT 'ongoing',
  studio VARCHAR(200),
  type VARCHAR(20) DEFAULT 'series' CHECK (type IN ('series', 'movie')),
  total_episodes INTEGER DEFAULT 0,
  duration VARCHAR(50),
  source_url VARCHAR(1000),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_anime_series_slug ON anime_series(slug);
CREATE INDEX idx_anime_series_type ON anime_series(type);
CREATE INDEX idx_anime_series_rating ON anime_series(rating DESC);
CREATE INDEX idx_anime_series_status ON anime_series(status);
CREATE INDEX idx_anime_series_updated ON anime_series(updated_at DESC);

-- 3. ANIME-GENRE JUNCTION
CREATE TABLE anime_genres (
  anime_id UUID REFERENCES anime_series(id) ON DELETE CASCADE,
  genre_id UUID REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (anime_id, genre_id)
);

CREATE INDEX idx_anime_genres_anime ON anime_genres(anime_id);
CREATE INDEX idx_anime_genres_genre ON anime_genres(genre_id);

-- 4. SEASONS
CREATE TABLE seasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  anime_id UUID NOT NULL REFERENCES anime_series(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  title VARCHAR(500),
  episode_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(anime_id, season_number)
);

CREATE INDEX idx_seasons_anime ON seasons(anime_id);

-- 5. EPISODES
CREATE TABLE episodes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID REFERENCES seasons(id) ON DELETE CASCADE,
  anime_id UUID NOT NULL REFERENCES anime_series(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  title VARCHAR(500),
  thumbnail VARCHAR(1000),
  description TEXT,
  air_date DATE,
  duration VARCHAR(50),
  source_url VARCHAR(1000),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(anime_id, episode_number, season_id)
);

CREATE INDEX idx_episodes_anime ON episodes(anime_id);
CREATE INDEX idx_episodes_season ON episodes(season_id);
CREATE INDEX idx_episodes_number ON episodes(anime_id, episode_number);

-- 6. VIDEO SOURCES
CREATE TABLE video_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  source_type VARCHAR(50) DEFAULT 'iframe',
  quality VARCHAR(20) DEFAULT 'HD',
  language VARCHAR(20) DEFAULT 'sub',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_video_sources_episode ON video_sources(episode_id);

-- 7. SCRAPING LOGS
CREATE TABLE scraping_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scraper_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  items_scraped INTEGER DEFAULT 0,
  errors TEXT,
  details JSONB
);

CREATE INDEX idx_scraping_logs_status ON scraping_logs(status);
CREATE INDEX idx_scraping_logs_started ON scraping_logs(started_at DESC);

-- 8. FEATURED ANIME (for homepage curation)
CREATE TABLE featured_anime (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  anime_id UUID NOT NULL REFERENCES anime_series(id) ON DELETE CASCADE,
  display_order INTEGER DEFAULT 0,
  banner_text VARCHAR(500),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_featured_anime_order ON featured_anime(display_order);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_anime_series_updated_at
  BEFORE UPDATE ON anime_series
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE genres ENABLE ROW LEVEL SECURITY;
ALTER TABLE anime_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE anime_genres ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraping_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE featured_anime ENABLE ROW LEVEL SECURITY;

-- Public read access policies
CREATE POLICY "Public read access" ON genres FOR SELECT USING (true);
CREATE POLICY "Public read access" ON anime_series FOR SELECT USING (true);
CREATE POLICY "Public read access" ON anime_genres FOR SELECT USING (true);
CREATE POLICY "Public read access" ON seasons FOR SELECT USING (true);
CREATE POLICY "Public read access" ON episodes FOR SELECT USING (true);
CREATE POLICY "Public read access" ON video_sources FOR SELECT USING (true);
CREATE POLICY "Public read access" ON featured_anime FOR SELECT USING (true);

-- Service role full access (for scraper)
CREATE POLICY "Service full access" ON genres FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service full access" ON anime_series FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service full access" ON anime_genres FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service full access" ON seasons FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service full access" ON episodes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service full access" ON video_sources FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service full access" ON scraping_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service full access" ON featured_anime FOR ALL USING (true) WITH CHECK (true);
