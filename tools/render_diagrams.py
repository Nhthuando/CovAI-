import zlib
import urllib.request
import string
import os

def plantuml_encode(text):
    plantuml_alphabet = string.digits + string.ascii_uppercase + string.ascii_lowercase + '-_'
    data = text.encode('utf-8')
    compress_obj = zlib.compressobj(9, zlib.DEFLATED, -15)
    compressed = compress_obj.compress(data) + compress_obj.flush()
    res = []
    for i in range(0, len(compressed), 3):
        b1 = compressed[i]
        b2 = compressed[i+1] if i+1 < len(compressed) else 0
        b3 = compressed[i+2] if i+2 < len(compressed) else 0
        c1 = b1 >> 2
        c2 = ((b1 & 0x3) << 4) | (b2 >> 4)
        c3 = ((b2 & 0xF) << 2) | (b3 >> 6)
        c4 = b3 & 0x3F
        res.append(plantuml_alphabet[c1 & 0x3F])
        res.append(plantuml_alphabet[c2 & 0x3F])
        if i + 1 < len(compressed):
            res.append(plantuml_alphabet[c3 & 0x3F])
        if i + 2 < len(compressed):
            res.append(plantuml_alphabet[c4 & 0x3F])
    return ''.join(res)

def render_puml_file(puml_path, output_png_path, output_svg_path):
    with open(puml_path, 'r', encoding='utf-8') as f:
        content = f.read()

    encoded = plantuml_encode(content)
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

    # Render PNG
    png_url = f'http://www.plantuml.com/plantuml/png/{encoded}'
    req = urllib.request.Request(png_url, headers=headers)
    with urllib.request.urlopen(req) as resp, open(output_png_path, 'wb') as out:
        out.write(resp.read())
    print(f"Generated PNG: {output_png_path} ({os.path.getsize(output_png_path)} bytes)")

    # Render SVG
    svg_url = f'http://www.plantuml.com/plantuml/svg/{encoded}'
    req = urllib.request.Request(svg_url, headers=headers)
    with urllib.request.urlopen(req) as resp, open(output_svg_path, 'wb') as out:
        out.write(resp.read())
    print(f"Generated SVG: {output_svg_path} ({os.path.getsize(output_svg_path)} bytes)")

if __name__ == '__main__':
    diagrams = [
        'covai-system-context',
        'covai-pipeline-workflow',
        'covai-pipeline-part1',
        'covai-pipeline-part2',
        'covai-database-erd',
        'covai-database-erd-part1',
        'covai-database-erd-part2',
    ]
    base_dir = r'd:\HuuThuan - Project\NCKH\CovAI\docs\architecture\diagrams'
    for diag in diagrams:
        puml_file = os.path.join(base_dir, f'{diag}.puml')
        png_file = os.path.join(base_dir, f'{diag}.png')
        svg_file = os.path.join(base_dir, f'{diag}.svg')
        if os.path.exists(puml_file):
            print(f"Rendering {diag}...")
            render_puml_file(puml_file, png_file, svg_file)

