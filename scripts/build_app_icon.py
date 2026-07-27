from argparse import ArgumentParser
from PIL import Image

parser = ArgumentParser(); parser.add_argument('--spritesheet', required=True); parser.add_argument('--output', required=True); args = parser.parse_args()
image = Image.open(args.spritesheet).convert('RGBA').crop((0, 0, 192, 208))
bounds = image.getbbox() or (0, 0, 192, 208); image = image.crop(bounds)
image.save(args.output, sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
