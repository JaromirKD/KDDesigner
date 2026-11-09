// tools/fxtest: on a PC, BigRam::Vec is a plain std::vector.
#pragma once
#include <vector>
namespace BigRam {
template <class T> using Vec = std::vector<T>;
}
