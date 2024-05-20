// Apify SDK - toolkit for building Apify Actors (Read more at https://docs.apify.com/sdk/js/).
import { Actor } from 'apify';
import { launchPuppeteer, sleep, PuppeteerCrawler, ProxyConfiguration } from 'crawlee';
import _ from 'lodash';
import puppeteerExtra from 'puppeteer-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import log from '@apify/log';
import jsonexport from 'jsonexport';
import fs from 'fs';

const DEBUG_MODE = true;

// this is ESM project, and as such, it requires you to specify extensions in your relative imports
// read more about this here: https://nodejs.org/docs/latest-v18.x/api/esm.html#mandatory-file-extensions
puppeteerExtra.use(stealthPlugin());

// The init() call configures the Actor for its environment. It's recommended to start every Actor with an init().
await Actor.init();

// Define the URLs to start the crawler with - get them from the input of the Actor or use a default list.
const input = await Actor.getInput();
console.log(input)
// const startUrls = input?.startUrls || [{ url: 'https://www.realtor.com/realestateagents/tampa_fl' }];
const proxyConfiguration = await Actor.createProxyConfiguration();

const getResultsFromPage = async (page) => {
  let r = await page.evaluate(() => {
    let jobs = [];

    for (let job of Array.from(document.querySelectorAll('article'))) {
      const jobData = {
        title: job.querySelector("h2").textContent.trim(),
        postedAt: job.querySelectorAll('div[data-test="JobTileHeader"] small span')[1].textContent.trim(),
        description: (job.querySelector('div[data-test="UpCLineClamp JobDescription"]').textContent.trim() || ""),
        url: job.querySelector("a").getAttribute('href'),
        fixedPriceBudget: (job.querySelector('li[data-test="is-fixed-price"]')?.textContent?.trim() || "").replace("Est. budget: \n ", "").trim(),
        contractType: (job.querySelector('ul[data-test="JobInfo"] > li:first-child')?.textContent?.trim() || ""),
        tags: Array.from(job.querySelectorAll('div[data-test="TokenClamp JobAttrs"] span')).map(tag => tag.textContent.trim()),
      }

      if (jobData.contractType.includes('Hourly')) {
        jobData.hourlyRate = jobData.contractType.replace('Hourly: ', '');
      }

      jobs.push(jobData)
    }



    return jobs;
  })
  r = r.map(job => ({ ...job, tags: _.uniq(job.tags) }))
  return r;
}
export const scrollToBottom = async (page) => {
  // await page.evaluate(() => {
  //   window.scrollBy(0, window.innerHeight);
  // });
  const pageHeight = await page.evaluate(() => {
    return document.body.scrollHeight;
  });

  // Define how many pixels to scroll each step
  const step = 500;

  // Scroll to the end of the page slowly
  for (let position = 0; position < pageHeight; position += step) {
    await page.evaluate(pos => {
      window.scrollTo(0, pos);
    }, position);

    // Add delay to make it scroll slowly
    await page.waitForTimeout(100);
  }
}
log.setLevel(log.LEVELS.DEBUG);
let allData = [];
console.log(input.searchQueries)
for (const searchQuery of input.searchQueries) {
  const url = `https://www.upwork.com/`


  // await initSearchByQuery(page, searchQuery)
  console.log(`Searching for ${searchQuery}`)
  // for (let retry = 0; retry < 3; retry++) {
  // console.log(`retry ${retry}`)
  try {

    let pageIndex = 1;
    const MAX_PAGES = 30;
    while (true) {
      if (pageIndex === MAX_PAGES) break;

      const browser = await launchPuppeteer({
        launcher: puppeteerExtra,
        launchOptions: {
          headless: true,
          args: ['--no-sandbox',
          ],
          proxyConfiguration
        },
      });

      let targetUrl = `${url}nx/search/jobs?q=${searchQuery.replace(/ /g, '+')}&per_page=50&sort=recency`
      if (pageIndex > 1) {
        targetUrl += `&page=${pageIndex}`
      }
      console.log(targetUrl)
      const page = await browser.newPage();
      // await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
      // await page.setViewport({
      //   width: 3456,
      //   height: 1280,
      //   // deviceScaleFactor: 2 // Optional, for retina display quality
      // });
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      // const htmlString = await page.content();
      // await Actor.pushData({ htmlString });

      // log.debug(htmlString)

      await scrollToBottom(page);
      await sleep(5000)
      console.log(`Page ${pageIndex++}`)
      let jobs = await getResultsFromPage(page)
      allData = [...allData, ...jobs];
      if (DEBUG_MODE) {
        const csv = await jsonexport(allData);
        fs.writeFileSync('jobs.csv', csv, 'utf8')
      }
      console.log(`[${searchQuery}] ${allData.length} jobs found`)
      Actor.pushData(jobs)
      const hasMoreResults = 
      await page.evaluate(() => {
        // return !document.body.textContent.includes('There are no results') && !document.body.textContent.includes(`We can't complete your request`)
        return (document.querySelector(".air3-pagination-next-btn") && !document.querySelector(".air3-pagination-next-btn.is-disabled"))
      });
      console.log(`hasMoreResults ${hasMoreResults}`)
      // await page.close();
      await browser.close();
      if (hasMoreResults) {
        // await page.click(".air3-pagination-next-btn");
        await sleep(5000)
      }
      else {
        break;
      }

    }

  }
  catch (e) {
    console.log(e)
  }
  // }
}
// await browser.close();

// Gracefully exit the Actor process. It's recommended to quit all Actors with an exit().
await Actor.exit();
