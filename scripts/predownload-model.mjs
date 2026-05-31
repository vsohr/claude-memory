// Pre-download the embedding model once, serially, before the test suite runs.
//
// Why: vitest runs test files in parallel workers. On a cold CI cache, several
// workers race to download Xenova/all-MiniLM-L6-v2 into the SAME shared cache
// dir (node_modules/@huggingface/transformers/.cache). A worker can read a
// half-written model.onnx, producing the intermittent
// "Load model ... failed:Protobuf parsing failed." (EMBEDDING_ERROR) that flaked
// the `test` gate in CI. Populating + validating the cache once up front removes
// that race so every worker hits a complete, valid model.
import { pipeline } from '@huggingface/transformers';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

async function main() {
    console.log(`[predownload] Fetching embedding model: ${MODEL_NAME}`);
    const extractor = await pipeline('feature-extraction', MODEL_NAME, {
        dtype: 'fp32',
    });
    // Exercise the pipeline once to force a full load + validate the ONNX graph.
    const out = await extractor('warmup', { pooling: 'mean', normalize: true });
    if (!out || !out.data || out.data.length === 0) {
        throw new Error('[predownload] Model produced an empty embedding');
    }
    console.log(
        `[predownload] Model ready (embedding dim=${out.data.length}).`
    );
}

main().catch((error) => {
    console.error('[predownload] Failed to pre-download model:', error);
    process.exit(1);
});
