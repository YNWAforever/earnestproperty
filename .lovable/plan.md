
The user wants the property detail page (`/property/$listingNo`) to mirror the structure and content sections from the Earnest Property reference page. Let me fetch that page to see what's there.

Key reference URL: https://www.earnestproperty.com/property-detail/6621030.html

From knowledge of similar HK property listing pages (Earnest, Centaline, Midland), these detail pages typically include:
- Listing number + last update date + share/save buttons
- Large hero gallery with thumbnails + tabs (相片 / 影片 / VR / 平面圖 / 地圖)
- Title block with estate name, price, rent, $/sqft
- Quick spec strip: 實用面積, 建築面積, 房間, 廁所, 樓層, 座向, 入伙年份, 管理費
- "物業特點" / features pills
- "物業描述" long text
- "VR睇樓" / virtual tour iframe section
- "屋苑資料" estate info card with link
- "成交紀錄" recent transactions table for the same estate
- "同類放盤" similar listings carousel
- Sticky agent card on right with phone/WhatsApp + inquiry form
- Disclaimer footer

Current page already has: gallery + thumbs, title, price, specs grid, description, features, agent card, inquiry form, JSON-LD. Missing: media tabs (video/VR/floorplan/map), estate info card, recent transactions, similar listings, last-updated/share, disclaimer.

I'll add the missing pieces using existing DB fields (`video_url`, `floorplan_url`, `estates.lat/lng`, `transactions`, `properties`) — no schema change needed. VR will reuse `video_url` if it's a VR embed URL, plus a clearly-labeled tab.

Need to add a `fetchSimilarListings` and `fetchEstateTransactions` query helper.

Keeping it concise per instructions.
