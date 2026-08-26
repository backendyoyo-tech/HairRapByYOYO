@"
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'ServiceCategory',
  'ServiceSubcategory',
  'Service',
  'ProductCategory',
  'Product',
  'InventoryMovement',
  'ServiceProductSuggestion',
  'WishlistItem',
  'ArtistService',
  'BookingService',
  'BookingServiceAssignment',
  'ServiceSession',
  'SessionEvent',
  'ServiceConsent'
)
ORDER BY table_name;
"@ | Set-Content .\check-catalogue.sql