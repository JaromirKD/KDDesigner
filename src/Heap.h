#pragma once
#include <stddef.h>

// The heap's small-block pool (Heap.cpp, HeapPool.h).
namespace Heap {
size_t poolFree();   // free bytes inside the pool's arena (mallinfo counts the arena as used)
}
