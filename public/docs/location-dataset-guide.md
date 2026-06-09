# Location Dataset Upload Guide

## File Format Requirements

Your CSV file must contain the following columns in this exact order:

1. **location_id** - Unique location identifier (text)
2. **location_name** - Human-readable location name (text)
3. **latitude** - Geographic latitude (decimal number)
4. **longitude** - Geographic longitude (decimal number)
5. **region** - Geographic region (text)
6. **country** - Country name (text)
7. **type** - Location type (text: Factory, Warehouse, Supplier, etc.)

## Data Quality Rules

- **Location IDs must be unique** within your dataset
- Location IDs cannot already exist in the database
- Latitude should be between -90 and 90
- Longitude should be between -180 and 180
- No missing values allowed for required fields

## Example Data

```csv
location_id,location_name,latitude,longitude,region,country,type
LOC001,Manufacturing Hub A,40.7128,-74.0060,North America,USA,Factory
LOC002,Distribution Center B,51.5074,-0.1278,Europe,UK,Warehouse
```

## Upload Process

1. Select "Location_DataSet" template type
2. Download the template file
3. Fill in your data following the format
4. Upload the file using the upload interface
5. Preview your data to check for errors
6. Save to database once validation passes