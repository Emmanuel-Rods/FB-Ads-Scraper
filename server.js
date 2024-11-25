const axios = require("axios");
const cheerio = require("cheerio");
const xlsx = require("xlsx");
const fs = require("fs");
const puppeteerExtra = require("puppeteer-extra");
const Stealth = require("puppeteer-extra-plugin-stealth");
puppeteerExtra.use(Stealth());

function queryURLBuilder(options) {
  options.q = encodeURIComponent(options.q);
  return `https://www.facebook.com/ads/library/?active_status=${options.active_status}&ad_type=${options.ad_type}&country=${options.country}&media_type=${options.media_type}&q=${options.q}&search_type=${options.search_type}`;
}
const adsData = [];
const graphQLData = [];
const otherAds = [];

const userQuery = {
  active_status: "active",
  ad_type: "all",
  country: "IN",
  media_type: "all",
  q: "Pet products",
  search_type: "keyword_exact_phrase", //keyword_unordered
};

console.log(userQuery);
async function run() {
  const browserObj = await puppeteerExtra.launch({ headless: true });
  const page = await browserObj.newPage();

  const url = queryURLBuilder(userQuery);

  try {
    await page.setViewport({ width: 1920, height: 1080 });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
    );

    //network payload code starts here (company data)

    // Intercept and monitor network responses
    await page.setRequestInterception(true);

    page.on("request", (request) => {
      request.continue();
    });

    page.on("response", async (response) => {
      try {
        const url = response.url();
        // Filter for GraphQL responses
        if (url.includes("/graphql")) {
          const jsonResponse = await response.json(); // Parse JSON response
          if (jsonResponse.data && jsonResponse.data.page) {
            const page = jsonResponse.data.page;
            graphQLData.push({
              name: page.name,
              category: page.category_name,
              profile_picture_uri: page.profile_picture_uri,
              likes: page.page_likers.count,
              website: page.websites[0],
              url: page.url,
              "company-text": page.best_description.text,
              "company-ads-profile": `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&media_type=all&search_type=page&view_all_page_id=${page.id}`,
            });
          }
          //add code here
          else if (
            jsonResponse.data.ad_library_main &&
            jsonResponse.data.ad_library_main.search_results_connection
          ) {
            const data =
              jsonResponse.data.ad_library_main.search_results_connection.edges;
            for (const ads of data) {
              const result = ads.node.collated_results[0];
              const unixTimestamp = result.start_date; // start with a Unix timestamp
              const date = new Date(unixTimestamp * 1000);
              otherAds.push({
                "Ad ID": result.ad_archive_id,
                "Ad link": `https://www.facebook.com/ads/library/?id=${result.ad_archive_id}`,
                "Started running on ": date.toDateString(),
                "Page Name:": result.page_name,
                Platforms: result.publisher_platform.join(', '),
                "Call to Action:": result.snapshot.cta_type,
              });
            }
            console.log(otherAds);
          }
        }
      } catch (err) {
        console.error(`Error parsing response: ${err}`);
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForNetworkIdle(); // Wait for network resources to fully load

    // Scroll dynamically to load all content
    const scrollPageToBottom = async () => {
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait for content to load
    };

    let previousHeight = 0;
    while (true) {
      await scrollPageToBottom();
      const newHeight = await page.evaluate(() => document.body.scrollHeight);
      if (newHeight === previousHeight) break;
      previousHeight = newHeight;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  } catch (e) {
    console.log(e);
  }
  // console.log("Collected GraphQL Data:", graphQLData);
  // console.log("Collected GraphQL Data Length:", graphQLData.length);
  console.log(`cherrio parser started`);
  //cheerio parser starts here
  const html = await page.content();
  const $ = cheerio.load(html);

  try {
    // Loop through all <script> tags and find the one containing the JSON data
    $("script").each((i, el) => {
      const scriptContent = $(el).html();

      if (
        scriptContent &&
        scriptContent.trim().startsWith("{") &&
        scriptContent.trim().endsWith("}")
      ) {
        try {
          // Parse the JSON content
          const jsonData = JSON.parse(scriptContent);

          // Check if the JSON contains the expected structure starting from `edges`
          if (
            jsonData.require &&
            jsonData.require[0] &&
            jsonData.require[0][3]
          ) {
            const edges =
              jsonData.require[0][3][0].__bbox.require[0][3][1].__bbox.result
                .data.ad_library_main.search_results_connection.edges;

            const count =
              jsonData.require[0][3][0].__bbox.require[0][3][1].__bbox.result
                .data.ad_library_main.search_results_connection.count;

            console.log(`~${count} Results`);
            // Iterate through all edges and extract data
            edges.forEach((edge, index) => {
              const collatedResults = edge.node.collated_results;
              if (collatedResults) {
                collatedResults.forEach((result, resultIndex) => {
                  const unixTimestamp = result.start_date; // start with a Unix timestamp

                  const date = new Date(unixTimestamp * 1000); // convert timestamp to milliseconds and construct Date object

                  adsData.push({
                    "Ad ID": result.ad_archive_id,
                    "Ad link": `https://www.facebook.com/ads/library/?id=${result.ad_archive_id}`,
                    "Started running on ": date.toDateString(),
                    "Page Name:": result.page_name,
                    Platforms: result.publisher_platform.join(", "),
                    "Call to Action:": result.snapshot.cta_type,
                  });
                });
              }
            });
          } else {
            // console.log("Expected data structure not found.");
          }
        } catch (error) {
          //   console.error("Error parsing JSON:", error.message);
        }
      }
    });
  } catch (error) {
    // console.error("Error:", error.message);
  } finally {
    browserObj.close();
    const allAds = [...adsData , ...otherAds]
    createExcelFile(`Ads.xlsx` , allAds )
    createExcelFile(`company data.xlsx` , graphQLData )
  }
}

run();

async function yearlyData() {
  let currentYear = new Date().getFullYear();
  let currentDate = new Date();

  let baseUrl = queryURLBuilder(userQuery);

  let totalAdsData = [];
  let year = 2018; // When ads were made public

  while (year <= currentYear) {
    // Format the dates in YYYY-MM-DD
    let startDate = `${year}-01-01`; // Start of the year
    let endDate;

    if (year === currentYear) {
      // Current year: Use today's date
      endDate = currentDate.toISOString().split("T")[0]; // Format today's date
    } else {
      // Past years: Use December 31
      endDate = `${year}-12-31`;
    }

    // Build URL with the new date range
    let yearUrl =
      baseUrl + `&start_date[min]=${startDate}&start_date[max]=${endDate}`;
    console.log(`Fetching data for year: ${year}, URL: ${yearUrl}`);

    try {
      // Make the API request
      const response = await axios.get(yearUrl);
      const html = response.data;

      // Parse the HTML using Cheerio
      const $ = cheerio.load(html);

      // Loop through all <script> tags and extract JSON data
      $("script").each((i, el) => {
        const scriptContent = $(el).html();

        // Check if the content looks like JSON
        if (
          scriptContent &&
          scriptContent.trim().startsWith("{") &&
          scriptContent.trim().endsWith("}")
        ) {
          try {
            // Parse the JSON content
            const jsonData = JSON.parse(scriptContent);

            // Extract the ads count (adjust structure based on actual response)
            if (
              jsonData.require &&
              jsonData.require[0] &&
              jsonData.require[0][3]
            ) {
              const count =
                jsonData.require[0][3][0].__bbox.require[0][3][1].__bbox.result
                  .data.ad_library_main.search_results_connection.count;

              // Store the result
              totalAdsData.push(count);
            }
          } catch (error) {
            // console.error("Error parsing JSON:", error.message);
          }
        }
      });
    } catch (error) {
      console.error(`Error fetching data for year ${year}:`, error.message);
    }

    year++; // Increment the year
  }
  console.log("Total Ads Data:", totalAdsData);
}

// yearlyData()

function createExcelFile(fileName, data) {
  try {
    // Step 1: Convert data array to a worksheet
    const worksheet = xlsx.utils.json_to_sheet(data);

    // Step 2: Create a new workbook and append the worksheet
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "Sheet1");

    // Step 3: Write the workbook to a file
    xlsx.writeFile(workbook, fileName);

    console.log(`Excel file "${fileName}" has been created successfully.`);
  } catch (error) {
    console.error("Error creating Excel file:", error);
  }
}