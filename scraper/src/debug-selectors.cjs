const cheerio = require('cheerio');

(async () => {
  const slugs = ['rezero-starting-life-in-another-world', 'that-time-i-got-reincarnated-as-a-slime', 'tsukimichi-moonlit-fantasy', 'witch-hat-atelier'];
  for (const slug of slugs) {
    const r = await fetch(`https://toonstream.vip/series/${slug}/`);
    const html = await r.text();
    const $ = cheerio.load(html);
    
    const seasonBtns = $('.choose-season .aa-cnt li a');
    const hasEpTemp = $('#episode_by_temp').length > 0;
    const seasontemps = [];
    seasonBtns.each((i, btn) => {
      const snum = parseInt($(btn).attr('data-season')) || 1;
      const st = $(`#seasontemp-${snum}`).length;
      seasontemps.push({ snum, hasSeasontemp: st > 0 });
    });
    const anyStatic = seasontemps.some(s => s.hasSeasontemp);
    
    console.log(`\n=== ${slug} ===`);
    console.log(`  seasonBtns: ${seasonBtns.length}`);
    console.log(`  seasontemps: ${seasontemps.map(s => `${s.snum}(${s.hasSeasontemp ? 'static' : 'ajax'})`).join(', ')}`);
    console.log(`  anyStatic: ${anyStatic}`);
    console.log(`  episode_by_temp: ${hasEpTemp}`);
    
    if (seasonBtns.length > 1 && !anyStatic) {
      console.log(`  => WOULD GO TO BROWSER (${slug})`);
    } else if (seasonBtns.length > 0 && anyStatic) {
      console.log(`  => CHEERIO multi-season path`);
    } else if (seasonBtns.length > 0 && seasonBtns.length === 1) {
      console.log(`  => CHEERIO single season from episode_by_temp`);
    } else {
      console.log(`  => NO season buttons`);
    }
  }
  process.exit(0);
})();
