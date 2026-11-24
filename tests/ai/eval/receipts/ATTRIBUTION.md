# Receipt photos for the live eval

`cord-01.jpg` … `cord-20.jpg` and their expected answers (`cord-NN.json`) are the first 20 receipts with a total and
priced lines from the **test split of CORD v2** (Park et al., "CORD: A Consolidated Receipt Dataset for Post-OCR
Parsing", NAVER Clova, 2019), https://huggingface.co/datasets/naver-clova-ix/cord-v2, licensed
**CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/). Changes: each photo shrunk to at most 1280 px on its
long side and saved as JPEG (as the app does before reading); the expected answers are the dataset's own labels
(`gt_parse`: menu lines and total) converted to whole hundredths of the receipt's currency (Indonesian rupiah). The
shops' names and addresses are blurred in the dataset itself; no personal data.

Corrected 24 Nov 2026 (docs/DECISIONS.md): the first conversion kept only CORD's top-level menu lines and dropped the
priced sub-lines (toppings and add-ons) printed under them, although the scan prompt counts every priced line and
cord-16 keeps its £0 lines. Added from the photos: cord-03 "COCONUT JELLY ( L )" 4,000; cord-08 "ADD CHICKEN BOX" 909;
cord-09 "COOKIE DOH SAUCES" 0 and "NATA DE COCO" 0; cord-15 "LONGAN", "ROASTED ALMOND" and "MANGGO", each 0. Totals
are unchanged.

Chosen instead of the owner's own receipts (owner, 18 Nov: "find receipts online"): this repository is public.
