-- Fix all anime that were incorrectly set to type='movie' due to scraper bug
-- The bug: $('body').text().includes('Movie') matched the nav link "Movies" on every page
UPDATE anime_series SET type = 'series' WHERE type = 'movie';

-- Update total_episodes based on actual episode count in the episodes table
UPDATE anime_series a
SET total_episodes = sub.ep_count
FROM (
  SELECT anime_id, COUNT(*) AS ep_count
  FROM episodes
  GROUP BY anime_id
) sub
WHERE a.id = sub.anime_id;
