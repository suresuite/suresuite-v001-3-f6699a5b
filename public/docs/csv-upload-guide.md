# CSV Upload Guide

## File Format Requirements

Your CSV file must contain the following columns in this exact order:

1. **from** - Source location (text)
2. **to** - Destination location (text) 
3. **plant** - Plant identifier (text, must be unique across all records)
4. **weighted** - Weight value (decimal number)
5. **material.consumption.rate** - Material consumption rate (decimal number)
6. **sourcing.ratio** - Sourcing ratio (decimal between 0-1)

## Data Quality Rules

- **Plant values must be unique** within your dataset
- Plant values cannot already exist in the database
- All numeric fields should be valid decimal numbers
- No missing values allowed for required fields

## Example Data

```csv
from,to,plant,weighted,material.consumption.rate,sourcing.ratio
Location A,Location B,Plant001,1.25,0.85,0.75
Location C,Location D,Plant002,2.40,1.20,0.90
```

## Upload Process

1. Download the template file
2. Fill in your data following the format
3. Upload the file using the upload interface
4. Preview your data to check for errors
5. Save to database once validation passes