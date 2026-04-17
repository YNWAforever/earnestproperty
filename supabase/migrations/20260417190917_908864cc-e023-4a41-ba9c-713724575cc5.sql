
-- Add 5 more district FAQs (to reach 10)
INSERT INTO public.faqs (scope, question, answer, sort_order) VALUES
('district:sham-tseng', '深井屬於哪個校網？', '深井小學校網為 62 校網，覆蓋荃灣西部及深井區，包括多間資助及直資小學。中學則屬荃灣區中學校網。', 6),
('district:sham-tseng', '深井有哪些主要屋苑？', '深井主要屋苑包括碧堤半島、浪翠園、海寶花園、海韻花園及香港花園，合共提供超過 10,000 個住宅單位。', 7),
('district:sham-tseng', '深井去中環要幾耐？', '由深井乘搭巴士經青馬大橋及西區海底隧道直達中環約 35 分鐘。亦可乘小巴至荃灣西站轉乘西鐵 / 屯馬綫。', 8),
('district:sham-tseng', '深井有甚麼配套設施？', '深井設有街市、超市、酒樓、診所及多間中小型食肆。屋苑會所一般設有泳池、健身室、兒童遊樂場及住客專車服務。', 9),
('district:sham-tseng', '深井放盤平均叫價如何？', '深井屋苑近期平均實用呎價約 $8,500 - $9,200，視乎屋苑、樓層及景觀而定，整體較荃灣市區便宜 10-15%。', 10);

-- Add monthly transactions across 12 months for chart
INSERT INTO public.transactions (estate_id, deal_type, price, saleable_area, saleable_psf, deal_date, unit) VALUES
('ac5c4ed1-512f-4a0d-af5c-247fa20d3036', 'sale', 8200000, 920, 8913, '2024-11-15', '5座 12A'),
('709e789f-daf8-4d48-8ce1-f8ba58bf2ebb', 'sale', 6800000, 780, 8718, '2024-12-08', '3座 8B'),
('9450028c-d2e6-43e6-a40d-67e01eaacbdf', 'sale', 7500000, 850, 8824, '2025-01-20', '2座 15A'),
('ac5c4ed1-512f-4a0d-af5c-247fa20d3036', 'sale', 9500000, 1050, 9048, '2025-02-14', '8座 20B'),
('8b8a9f4a-0aa0-4b13-91de-d7ae103434df', 'sale', 6200000, 720, 8611, '2025-03-10', '1座 6A'),
('709e789f-daf8-4d48-8ce1-f8ba58bf2ebb', 'sale', 7100000, 800, 8875, '2025-04-22', '4座 11B'),
('82c3de23-d777-4481-ba09-25670ad9197a', 'sale', 5800000, 680, 8529, '2025-05-18', '2座 9A'),
('ac5c4ed1-512f-4a0d-af5c-247fa20d3036', 'sale', 8800000, 950, 9263, '2025-06-25', '6座 14B'),
('9450028c-d2e6-43e6-a40d-67e01eaacbdf', 'sale', 7800000, 870, 8966, '2025-07-08', '3座 18A');
