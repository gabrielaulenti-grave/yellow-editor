// SPDX-License-Identifier: MIT
//
// Yellow Editor browser compatibility implementation for the subset of
// RGBDS rgbgfx used by pret/pokeyellow and pret/pokered.
//
// The Gen I Makefiles only require:
//   --colors dmg
//   --columns (selected Red/Blue intro graphics)
//   --depth 1 (selected 1bpp assets)
//   -o <output>
//
// PNG decoding is performed from an in-memory byte buffer with LodePNG. This
// deliberately avoids libpng's setjmp/callback machinery and C++ streambuf
// objects at the PNG decoder boundary, which are unreliable in our Emscripten
// build. The tile serialization below follows RGBDS 1.0.3's DMG grayscale
// mapping, tile order, and bitplane order for this supported subset.
//
// This WASM module is built as a library-style reactor instead of a command-
// line program. JavaScript calls yellow_editor_rgbgfx directly through ccall,
// which avoids Emscripten's main()/exit teardown path while still using its
// virtual filesystem for input and output files.

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include <emscripten/emscripten.h>

#include "lodepng.h"

namespace {

struct Options {
    bool columnMajor = false;
    unsigned depth = 2;
    std::string input;
    std::string output;
};

void printError(char const *message) {
    std::fprintf(stderr, "rgbgfx: error: %s\n", message);
}

void printError(std::string const &message) {
    printError(message.c_str());
}

bool readFile(std::string const &path, std::vector<unsigned char> &bytes) {
    FILE *file = std::fopen(path.c_str(), "rb");
    if (!file) {
        printError("Failed to open input PNG '" + path + "'.");
        return false;
    }

    std::array<unsigned char, 64 * 1024> buffer{};
    for (;;) {
        size_t const count = std::fread(buffer.data(), 1, buffer.size(), file);
        bytes.insert(bytes.end(), buffer.begin(), buffer.begin() + count);
        if (count != buffer.size()) {
            if (std::ferror(file)) {
                std::fclose(file);
                printError("Failed while reading input PNG '" + path + "'.");
                return false;
            }
            break;
        }
    }

    if (std::fclose(file) != 0) {
        printError("Failed to close input PNG '" + path + "'.");
        return false;
    }
    return true;
}

bool writeFile(std::string const &path, std::vector<unsigned char> const &bytes) {
    FILE *file = std::fopen(path.c_str(), "wb");
    if (!file) {
        printError("Failed to create output file '" + path + "'.");
        return false;
    }
    if (!bytes.empty() && std::fwrite(bytes.data(), 1, bytes.size(), file) != bytes.size()) {
        std::fclose(file);
        printError("Failed while writing output file '" + path + "'.");
        return false;
    }
    if (std::fclose(file) != 0) {
        printError("Failed to close output file '" + path + "'.");
        return false;
    }
    return true;
}

unsigned dmgIndex(unsigned red, unsigned depth) {
    // RGBDS 1.0.3 Rgba::grayIndex with the default `--colors dmg`
    // palette (0xE4): PNG brightness is inverted to Game Boy shade order,
    // reduced to four DMG bins, then reduced to the active palette size.
    unsigned const fourShadeIndex = (255u - red) * 4u / 256u;
    unsigned const colorsPerPalette = 1u << depth;
    return fourShadeIndex * colorsPerPalette / 4u;
}

bool validatePixels(
    std::vector<unsigned char> const &rgba,
    unsigned width,
    unsigned height,
    unsigned depth
) {
    unsigned const colorsPerPalette = 1u << depth;
    std::vector<unsigned> reducedGrays;
    std::array<bool, 4> usedOutputBins{};

    for (size_t offset = 0; offset < rgba.size(); offset += 4) {
        unsigned const red = rgba[offset];
        unsigned const green = rgba[offset + 1];
        unsigned const blue = rgba[offset + 2];
        unsigned const alpha = rgba[offset + 3];

        // RGBDS considers alpha < 0x10 transparent and alpha >= 0xF0 opaque;
        // `--colors dmg` rejects transparency, and intermediate alpha values
        // are invalid rather than silently rounded.
        if (alpha < 0xF0) {
            printError(
                alpha < 0x10
                    ? "DMG palette input may not contain transparent pixels."
                    : "PNG contains a pixel whose alpha is neither transparent nor opaque."
            );
            return false;
        }
        if (red != green || green != blue) {
            printError("Image is not compatible with a DMG palette: it contains a non-gray color.");
            return false;
        }

        // RGBDS registers colors after reduction to RGB555. Track those same
        // unique grayscale values for its color-count and bin-conflict checks.
        unsigned const reduced = red >> 3;
        if (std::find(reducedGrays.begin(), reducedGrays.end(), reduced) == reducedGrays.end()) {
            reducedGrays.push_back(reduced);
            if (reducedGrays.size() > colorsPerPalette) {
                printError("Image is not compatible with a DMG palette: it contains too many colors.");
                return false;
            }
            unsigned const outputBin = dmgIndex(red, depth);
            if (usedOutputBins[outputBin]) {
                printError(
                    "Image is not compatible with a DMG palette: two colors reduce to the same gray shade."
                );
                return false;
            }
            usedOutputBins[outputBin] = true;
        }
    }

    if (width == 0 || height == 0 || width % 8 != 0 || height % 8 != 0) {
        printError("PNG width and height must both be nonzero multiples of 8 pixels.");
        return false;
    }
    return true;
}

void appendTile(
    std::vector<unsigned char> &output,
    std::vector<unsigned char> const &rgba,
    unsigned imageWidth,
    unsigned tileX,
    unsigned tileY,
    unsigned depth
) {
    for (unsigned y = 0; y < 8; ++y) {
        unsigned lowPlane = 0;
        unsigned highPlane = 0;
        for (unsigned x = 0; x < 8; ++x) {
            size_t const offset =
                (static_cast<size_t>(tileY + y) * imageWidth + tileX + x) * 4;
            unsigned const index = dmgIndex(rgba[offset], depth);
            lowPlane = (lowPlane << 1) | (index & 1u);
            highPlane = (highPlane << 1) | ((index >> 1) & 1u);
        }
        output.push_back(static_cast<unsigned char>(lowPlane));
        if (depth == 2) {
            output.push_back(static_cast<unsigned char>(highPlane));
        }
    }
}

bool convert(Options const &options) {
    std::vector<unsigned char> pngBytes;
    if (!readFile(options.input, pngBytes)) {
        return false;
    }

    std::vector<unsigned char> rgba;
    unsigned width = 0;
    unsigned height = 0;
    unsigned const decodeError = lodepng::decode(rgba, width, height, pngBytes);
    if (decodeError != 0) {
        printError(
            "Could not decode PNG '" + options.input + "': " + lodepng_error_text(decodeError)
        );
        return false;
    }
    if (rgba.size() != static_cast<size_t>(width) * height * 4) {
        printError("PNG decoder returned an unexpected RGBA buffer size.");
        return false;
    }
    if (!validatePixels(rgba, width, height, options.depth)) {
        return false;
    }

    unsigned const widthTiles = width / 8;
    unsigned const heightTiles = height / 8;
    size_t const bytesPerTile = options.depth == 2 ? 16 : 8;
    std::vector<unsigned char> output;
    output.reserve(static_cast<size_t>(widthTiles) * heightTiles * bytesPerTile);

    if (options.columnMajor) {
        // RGBDS's column-major visitor advances Y first, then X.
        for (unsigned tileX = 0; tileX < width; tileX += 8) {
            for (unsigned tileY = 0; tileY < height; tileY += 8) {
                appendTile(output, rgba, width, tileX, tileY, options.depth);
            }
        }
    } else {
        for (unsigned tileY = 0; tileY < height; tileY += 8) {
            for (unsigned tileX = 0; tileX < width; tileX += 8) {
                appendTile(output, rgba, width, tileX, tileY, options.depth);
            }
        }
    }

    return writeFile(options.output, output);
}

} // namespace

extern "C" EMSCRIPTEN_KEEPALIVE int yellow_editor_rgbgfx(
    char const *input,
    char const *output,
    int depth,
    int columnMajor
) {
    if (!input || !*input) {
        printError("Missing input PNG path.");
        return 1;
    }
    if (!output || !*output) {
        printError("Missing output tile-data path.");
        return 1;
    }
    if (depth != 1 && depth != 2) {
        printError("The Gen I browser build only supports 1bpp and 2bpp graphics.");
        return 1;
    }

    Options options;
    options.columnMajor = columnMajor != 0;
    options.depth = static_cast<unsigned>(depth);
    options.input = input;
    options.output = output;
    return convert(options) ? 0 : 1;
}
