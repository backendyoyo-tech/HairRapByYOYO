-- Seed data for Catalogue APIs
-- Run this AFTER migration.sql in Supabase SQL Editor

-- ============================================
-- 1. SERVICE CATEGORIES & SUBCATEGORIES
-- ============================================

INSERT INTO "ServiceCategory" (id, name, description, "displayOrder", "isActive", "createdAt", "updatedAt") VALUES
('cat_hair', 'Hair Services', 'Cut, color, styling, and treatments', 1, true, NOW(), NOW()),
('cat_beard', 'Beard & Grooming', 'Beard trim, shape, and grooming', 2, true, NOW(), NOW()),
('cat_facial', 'Facial & Skin', 'Facials, cleanup, and skin treatments', 3, true, NOW(), NOW()),
('cat_package', 'Packages', 'Combo deals and wedding packages', 4, true, NOW(), NOW())
ON CONFLICT DO NOTHING;

INSERT INTO "ServiceSubcategory" (id, "categoryId", name, description, "displayOrder", "isActive", "createdAt", "updatedAt") VALUES
('sub_hair_cut', 'cat_hair', 'Hair Cut', 'Precision cuts and trims', 1, true, NOW(), NOW()),
('sub_hair_color', 'cat_hair', 'Hair Color', 'Full color, highlights, balayage', 2, true, NOW(), NOW()),
('sub_hair_treatment', 'cat_hair', 'Hair Treatment', 'Keratin, smoothing, repair', 3, true, NOW(), NOW()),
('sub_hair_styling', 'cat_hair', 'Styling', 'Blowout, updos, occasion styling', 4, true, NOW(), NOW()),
('sub_beard_trim', 'cat_beard', 'Beard Trim', 'Shape and maintenance', 1, true, NOW(), NOW()),
('sub_beard_shape', 'cat_beard', 'Beard Shape', 'Full redesign and shaping', 2, true, NOW(), NOW()),
('sub_facial_basic', 'cat_facial', 'Basic Facial', 'Cleanup and hydration', 1, true, NOW(), NOW()),
('sub_facial_advanced', 'cat_facial', 'Advanced Facial', 'Anti-aging, brightening, acne', 2, true, NOW(), NOW()),
('sub_package_wedding', 'cat_package', 'Wedding Packages', 'Groom and party packages', 1, true, NOW(), NOW()),
('sub_package_grooming', 'cat_package', 'Grooming Packages', 'Complete grooming combos', 2, true, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- ============================================
-- 2. SERVICES
-- ============================================

INSERT INTO "Service" (id, "subcategoryId", name, description, "durationMinutes", gender, "requiredArtistCount", active, "creativeDirectorEligible", "allowsParallelClientService", "riskClass", "requiresServiceConsent", price, "displayOrder", "createdAt", "updatedAt") VALUES
-- Hair Cuts
('svc_cut_classic', 'sub_hair_cut', 'Classic Cut', 'Precision scissor cut with consultation', 30, 'MALE', 1, true, false, false, 'NORMAL', false, 599.00, 1, NOW(), NOW()),
('svc_cut_fade', 'sub_hair_cut', 'Fade Cut', 'Skin fade with blending and lineup', 30, 'MALE', 1, true, false, false, 'NORMAL', false, 699.00, 2, NOW(), NOW()),
('svc_cut_textured', 'sub_hair_cut', 'Textured Cut', 'Layered/textured cut for volume', 45, 'UNISEX', 1, true, true, false, 'NORMAL', false, 899.00, 3, NOW(), NOW()),
('svc_cut_womens', 'sub_hair_cut', 'Women''s Cut', 'Custom cut with wash and blowout', 45, 'FEMALE', 1, true, false, false, 'NORMAL', false, 999.00, 4, NOW(), NOW()),

-- Hair Color
('svc_color_full', 'sub_hair_color', 'Full Color', 'Single process root-to-tip color', 90, 'UNISEX', 1, true, false, false, 'HIGH_RISK', true, 2499.00, 1, NOW(), NOW()),
('svc_color_highlights', 'sub_hair_color', 'Highlights', 'Partial or full foil highlights', 120, 'UNISEX', 1, true, true, false, 'HIGH_RISK', true, 3499.00, 2, NOW(), NOW()),
('svc_color_balayage', 'sub_hair_color', 'Balayage', 'Hand-painted natural look', 150, 'UNISEX', 1, true, true, false, 'HIGH_RISK', true, 4499.00, 3, NOW(), NOW()),

-- Hair Treatments
('svc_treat_keratin', 'sub_hair_treatment', 'Keratin Treatment', 'Frizz-free smooth up to 3 months', 180, 'UNISEX', 1, true, false, false, 'HIGH_RISK', true, 4999.00, 1, NOW(), NOW()),
('svc_treat_repair', 'sub_hair_treatment', 'Bond Repair', 'Olaplex-style bond building', 60, 'UNISEX', 1, true, false, false, 'NORMAL', false, 1499.00, 2, NOW(), NOW()),

-- Styling
('svc_style_blowout', 'sub_hair_styling', 'Blowout', 'Wash, blowout, and finish', 30, 'UNISEX', 1, true, false, true, 'NORMAL', false, 499.00, 1, NOW(), NOW()),
('svc_style_updo', 'sub_hair_styling', 'Occasion Updo', 'Event styling with accessories', 60, 'FEMALE', 1, true, true, false, 'NORMAL', false, 1499.00, 2, NOW(), NOW()),

-- Beard
('svc_beard_trim', 'sub_beard_trim', 'Beard Trim', 'Shape, trim, and oil finish', 15, 'MALE', 1, true, false, true, 'NORMAL', false, 299.00, 1, NOW(), NOW()),
('svc_beard_shape', 'sub_beard_shape', 'Beard Reshape', 'Full redesign with hot towel', 30, 'MALE', 1, true, false, false, 'NORMAL', false, 499.00, 2, NOW(), NOW()),

-- Facial
('svc_facial_cleanup', 'sub_facial_basic', 'Deep Cleanup', 'Cleanse, steam, extract, mask', 45, 'UNISEX', 1, true, false, true, 'NORMAL', false, 799.00, 1, NOW(), NOW()),
('svc_facial_brightening', 'sub_facial_advanced', 'Brightening Facial', 'Vitamin C, exfoliation, glow', 60, 'UNISEX', 1, true, false, false, 'NORMAL', false, 1299.00, 2, NOW(), NOW()),

-- Packages
('svc_pkg_groom_complete', 'sub_package_grooming', 'Complete Grooming', 'Cut + beard + facial + head massage', 90, 'MALE', 1, true, false, false, 'NORMAL', false, 1799.00, 1, NOW(), NOW()),
('svc_pkg_wedding_groom', 'sub_package_wedding', 'Groom Wedding Pack', 'Cut, color, facial, beard, trial session', 180, 'MALE', 1, true, true, false, 'NORMAL', false, 4999.00, 2, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- ============================================
-- 3. PRODUCT CATEGORIES & PRODUCTS
-- ============================================

INSERT INTO "ProductCategory" (id, name, description, "displayOrder", "isActive", "createdAt", "updatedAt") VALUES
('prod_cat_shampoo', 'Shampoo & Conditioner', 'Hair cleansing and care', 1, true, NOW(), NOW()),
('prod_cat_styling', 'Styling Products', 'Gels, waxes, pomades, sprays', 2, true, NOW(), NOW()),
('prod_cat_beard', 'Beard Care', 'Oils, balms, washes', 3, true, NOW(), NOW()),
('prod_cat_treatment', 'Treatments & Masks', 'Deep conditioning, repair', 4, true, NOW(), NOW()),
('prod_cat_tools', 'Tools & Accessories', 'Combs, brushes, trimmers', 5, true, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- 3 Initial Products as requested: BioTop, GK, PH
INSERT INTO "Product" (id, "categoryId", name, description, type, price, cost, "stockQty", "lowStockThreshold", sku, barcode, "isActive", "displayOrder", "createdAt", "updatedAt") VALUES
('prod_biotop_shampoo', 'prod_cat_shampoo', 'BioTop Anti-Hairfall Shampoo', 'Clinical formula with biotin, caffeine, saw palmetto. Reduces hairfall in 4 weeks.', 'RETAIL', 899.00, 450.00, 50, 10, 'BIO-SHMP-250', '8901234567890', true, 1, NOW(), NOW()),
('prod_gk_serum', 'prod_cat_treatment', 'GK Hair Serum', 'Keratin-infused serum for frizz control, shine, and heat protection up to 230°C.', 'RETAIL', 1299.00, 650.00, 30, 8, 'GK-SER-50', '8901234567891', true, 1, NOW(), NOW()),
('prod_ph_pomade', 'prod_cat_styling', 'PH Matte Clay Pomade', 'Strong hold, matte finish, water-based, washes out easy. All-day hold.', 'RETAIL', 699.00, 320.00, 40, 10, 'PH-POM-100', '8901234567892', true, 1, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- ============================================
-- 4. ARTIST ACCOUNTS & PROFILES
-- ============================================

-- First create accounts for artists
INSERT INTO "Account" (id, "accountType", email, phone, username, "passwordHash", role, "isActive", "isVerified", "createdAt", "updatedAt") VALUES
('acc_cd_yoyo', 'ARTIST', 'yoyo.sir@hairrap.com', '+919876543210', 'yoyo.sir', '$2b$12$hashedpassword', 'ARTIST', true, true, NOW(), NOW()),
('acc_top_artist', 'ARTIST', 'top.artist@hairrap.com', '+919876543211', 'topartist', '$2b$12$hashedpassword', 'ARTIST', true, true, NOW(), NOW()),
('acc_senior_artist', 'ARTIST', 'senior.artist@hairrap.com', '+919876543212', 'seniorartist', '$2b$12$hashedpassword', 'ARTIST', true, true, NOW(), NOW()),
('acc_junior_artist', 'ARTIST', 'junior.artist@hairrap.com', '+919876543213', 'juniorartist', '$2b$12$hashedpassword', 'ARTIST', true, true, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- Now create artist profiles
INSERT INTO "ArtistProfile" (id, "accountId", "firstName", "lastName", "displayName", specialization, bio, "isAvailable", "createdAt", "updatedAt") VALUES
('art_cd_yoyo', 'acc_cd_yoyo', 'Yogesh', 'Sir', 'YOYO Sir — Creative Director', 'Creative Direction, Color Architecture, Precision Cutting', 'Founder & Creative Director with 20+ years transforming hair artistry. Specialist in bespoke color architecture, precision cutting, and bridal couture. Trained 500+ artists globally.', true, NOW(), NOW()),
('art_top_artist', 'acc_top_artist', 'Rahul', 'Sharma', 'Rahul Sharma — Top Artist', 'Advanced Color, Balayage, Creative Cutting', 'Award-winning colorist with 12+ years experience. Expert in balayage, color correction, and creative cutting. International competition winner.', true, NOW(), NOW()),
('art_senior_artist', 'acc_senior_artist', 'Priya', 'Patel', 'Priya Patel — Senior Artist', 'Bridal Styling, Updos, Hair Treatments', 'Senior artist with 8+ years specializing in bridal styling, intricate updos, and restorative hair treatments. Certified in keratin & bond repair.', true, NOW(), NOW()),
('art_junior_artist', 'acc_junior_artist', 'Arjun', 'Singh', 'Arjun Singh — Junior Artist', 'Classic Cuts, Beard Grooming, Basic Color', 'Enthusiastic junior artist with 3+ years. Strong foundation in classic cuts, beard shaping, and essential color techniques. Fast learner, detail-oriented.', true, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- ============================================
-- 5. ARTIST-SERVICE MAPPING
-- ============================================

-- YOYO Sir (Creative Director) - ALL services, especially creativeDirectorEligible
INSERT INTO "ArtistService" (id, "artistId", "serviceId", "isActive", "createdAt", "updatedAt") VALUES
('as_cd_1', 'art_cd_yoyo', 'svc_cut_textured', true, NOW(), NOW()),
('as_cd_2', 'art_cd_yoyo', 'svc_color_balayage', true, NOW(), NOW()),
('as_cd_3', 'art_cd_yoyo', 'svc_color_highlights', true, NOW(), NOW()),
('as_cd_4', 'art_cd_yoyo', 'svc_pkg_wedding_groom', true, NOW(), NOW()),
('as_cd_5', 'art_cd_yoyo', 'svc_style_updo', true, NOW(), NOW()),
('as_cd_6', 'art_cd_yoyo', 'svc_treat_keratin', true, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- Top Artist - Advanced color, cutting, styling
INSERT INTO "ArtistService" (id, "artistId", "serviceId", "isActive", "createdAt", "updatedAt") VALUES
('as_top_1', 'art_top_artist', 'svc_cut_textured', true, NOW(), NOW()),
('as_top_2', 'art_top_artist', 'svc_cut_womens', true, NOW(), NOW()),
('as_top_3', 'art_top_artist', 'svc_color_balayage', true, NOW(), NOW()),
('as_top_4', 'art_top_artist', 'svc_color_highlights', true, NOW(), NOW()),
('as_top_5', 'art_top_artist', 'svc_color_full', true, NOW(), NOW()),
('as_top_6', 'art_top_artist', 'svc_style_updo', true, NOW(), NOW()),
('as_top_7', 'art_top_artist', 'svc_treat_keratin', true, NOW(), NOW()),
('as_top_8', 'art_top_artist', 'svc_treat_repair', true, NOW(), NOW()),
('as_top_9', 'art_top_artist', 'svc_pkg_groom_complete', true, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- Senior Artist - Styling, treatments, bridal, grooming packages
INSERT INTO "ArtistService" (id, "artistId", "serviceId", "isActive", "createdAt", "updatedAt") VALUES
('as_sen_1', 'art_senior_artist', 'svc_cut_classic', true, NOW(), NOW()),
('as_sen_2', 'art_senior_artist', 'svc_cut_womens', true, NOW(), NOW()),
('as_sen_3', 'art_senior_artist', 'svc_color_full', true, NOW(), NOW()),
('as_sen_4', 'art_senior_artist', 'svc_style_blowout', true, NOW(), NOW()),
('as_sen_5', 'art_senior_artist', 'svc_style_updo', true, NOW(), NOW()),
('as_sen_6', 'art_senior_artist', 'svc_treat_repair', true, NOW(), NOW()),
('as_sen_7', 'art_senior_artist', 'svc_facial_cleanup', true, NOW(), NOW()),
('as_sen_8', 'art_senior_artist', 'svc_facial_brightening', true, NOW(), NOW()),
('as_sen_9', 'art_senior_artist', 'svc_pkg_groom_complete', true, NOW(), NOW()),
('as_sen_10', 'art_senior_artist', 'svc_pkg_wedding_groom', true, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- Junior Artist - Basic cuts, beard, cleanup, basic color
INSERT INTO "ArtistService" (id, "artistId", "serviceId", "isActive", "createdAt", "updatedAt") VALUES
('as_jun_1', 'art_junior_artist', 'svc_cut_classic', true, NOW(), NOW()),
('as_jun_2', 'art_junior_artist', 'svc_cut_fade', true, NOW(), NOW()),
('as_jun_3', 'art_junior_artist', 'svc_beard_trim', true, NOW(), NOW()),
('as_jun_4', 'art_junior_artist', 'svc_beard_shape', true, NOW(), NOW()),
('as_jun_5', 'art_junior_artist', 'svc_facial_cleanup', true, NOW(), NOW()),
('as_jun_6', 'art_junior_artist', 'svc_color_full', true, NOW(), NOW()),
('as_jun_7', 'art_junior_artist', 'svc_style_blowout', true, NOW(), NOW()),
('as_jun_8', 'art_junior_artist', 'svc_pkg_groom_complete', true, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- ============================================
-- 6. SERVICE-PRODUCT SUGGESTIONS (Cross-sell)
-- ============================================

INSERT INTO "ServiceProductSuggestion" (id, "serviceId", "productId", "displayOrder", "createdAt") VALUES
('sps_1', 'svc_cut_classic', 'prod_biotop_shampoo', 1, NOW()),
('sps_2', 'svc_cut_fade', 'prod_biotop_shampoo', 1, NOW()),
('sps_3', 'svc_color_full', 'prod_gk_serum', 1, NOW()),
('sps_4', 'svc_color_highlights', 'prod_gk_serum', 1, NOW()),
('sps_5', 'svc_color_balayage', 'prod_gk_serum', 1, NOW()),
('sps_6', 'svc_treat_keratin', 'prod_gk_serum', 1, NOW()),
('sps_7', 'svc_style_blowout', 'prod_ph_pomade', 1, NOW()),
('sps_8', 'svc_style_updo', 'prod_ph_pomade', 1, NOW()),
('sps_9', 'svc_beard_trim', 'prod_ph_pomade', 1, NOW()),
('sps_10', 'svc_pkg_groom_complete', 'prod_biotop_shampoo', 1, NOW()),
('sps_11', 'svc_pkg_groom_complete', 'prod_gk_serum', 2, NOW()),
('sps_12', 'svc_pkg_groom_complete', 'prod_ph_pomade', 3, NOW())
ON CONFLICT DO NOTHING;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check counts
SELECT 'ServiceCategory' as table_name, COUNT(*) FROM "ServiceCategory"
UNION ALL SELECT 'ServiceSubcategory', COUNT(*) FROM "ServiceSubcategory"
UNION ALL SELECT 'Service', COUNT(*) FROM "Service"
UNION ALL SELECT 'ProductCategory', COUNT(*) FROM "ProductCategory"
UNION ALL SELECT 'Product', COUNT(*) FROM "Product"
UNION ALL SELECT 'ArtistProfile', COUNT(*) FROM "ArtistProfile"
UNION ALL SELECT 'ArtistService', COUNT(*) FROM "ArtistService"
UNION ALL SELECT 'ServiceProductSuggestion', COUNT(*) FROM "ServiceProductSuggestion";

-- Test API-like queries
-- Services with categories
SELECT s.name as service, sc.name as category, ssc.name as subcategory, s.price, s.durationMinutes
FROM "Service" s
LEFT JOIN "ServiceSubcategory" ssc ON s."subcategoryId" = ssc.id
LEFT JOIN "ServiceCategory" sc ON ssc."categoryId" = sc.id
WHERE s.active = true
ORDER BY sc."displayOrder", ssc."displayOrder", s."displayOrder";

-- Products with categories
SELECT p.name as product, pc.name as category, p.price, p."stockQty", p.type
FROM "Product" p
JOIN "ProductCategory" pc ON p."categoryId" = pc.id
WHERE p."isActive" = true
ORDER BY pc."displayOrder", p."displayOrder";

-- Artists with services
SELECT ap."displayName" as artist, COUNT(arts."serviceId") as service_count
FROM "ArtistProfile" ap
LEFT JOIN "ArtistService" arts ON ap.id = arts."artistId" AND arts."isActive" = true
GROUP BY ap.id, ap."displayName"
ORDER BY service_count DESC;