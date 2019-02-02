import flatten from 'lodash/flatten';
import chunk from 'lodash/chunk';
import unzip from 'lodash/unzip';
import sortBy from 'lodash/sortBy';
import lodashTake from 'lodash/take';


let internalFrum = null;

const first = (list) => {
  for (const v of list) return v;
  return null;
};

const last = (list) => {
  let value = null;
  for (const v of list) value = v;
  return value;
};


const toArray = (value) => {
  // return a list
  if (Array.isArray(value)) {
    return value;
  } if (value == null) {
    return [];
  }
    return [value];
};

const selector = (column_name) => {
  // convert string into function that selects column from row
  if (typeof column_name === 'string') {
    return row => row[column_name];
  } return column_name;
};


class Wrapper {
  constructor(argslist) {
    if (!Array.isArray(argslist) || (argslist.length > 0 && !Array.isArray(argslist[0]))) {
      console.log(`expecting Array of tuples, not: ${JSON.stringify(argslist)}`);
      throw Error(`expecting Array of tuples, not: ${JSON.stringify(argslist)}`);
    }
    this.argslist = argslist;
  }

  * [Symbol.iterator]() {
    for (const [a] of this.argslist) {
      yield a;
    }
  }

  // ///////////////////////////////////////////////////////////////////////////
  // CHAINABLE METHODS
  // ///////////////////////////////////////////////////////////////////////////

  map(func) {
    // map the value, do not touch the other args
    return new Wrapper(
      this.argslist.map(([value, ...args]) => [func(value, ...args), ...args]),
    );
  }

  enumerate() {
    // append extra index paramter to args
    return new Wrapper(
      this.argslist.map((args, i) => [...args, i]),
    );
  }

  args() {
    // Convert value into args
    return new Wrapper(
      this.argslist.map(arg => arg[0]),
    );
  }

  filter(func) {
    return new Wrapper(this.argslist.filter(args => func(...args)));
  }

  where(expression) {
    // Expecting a object of {column_name: value} form to use as a filter
    // return only matching rows
    const func = (row) => {
      for (const [name, value] of Object.entries(expression)) {
        if (row[name] !== value) return false;
      }
      return true;
    };

    return this.filter(func);
  }

  exists(columns = null) {
    // Expect a list of column names that must exist
    let func = null;

    if (columns == null) {
      func = row => row != null;
    } else {
      const cols = toArray(columns);
      func = (row) => {
        for (const name of cols) {
          const v = row[name];
          if (v == null || Number.isNaN(v)) return false;
        }
        return true;
      };
    }
    return this.filter(func);
  }

  groupBy(columns) {
    // Groupby one, or many, columns by name or by {name: selector} pairs
    // return array of [rows, key, index] tuples

    if (Array.isArray(columns)) {
      const cs = internalFrum(columns)
        .map((col_name) => {
          if (typeof col_name === 'string') {
            return [[selector(col_name), col_name]];
          }
          return Object.entries(col_name).map((name, value) => [selector(value), name]);
        })
        .flatten()
        .sortBy(([_, b]) => b)
        .args();

      const output = {};
      let g = 0;
      for (const arg of this.argslist) {
        const key = cs.map(func => func(...arg)).fromPairs();
        const skey = JSON.stringify(key);

        let triple = output[skey];
        if (!triple) {
          triple = [[], key, g];
          g += 1;
          output[skey] = triple;
        }
        triple[0].push(arg[0]);
      }
      return Object.values(output);
    }

    // single-column groupby is faster
    const func = selector(columns);
    const output = {};
    let i = 0;
    for (const [row, ...arg] of this.argslist) {
      const key = func(row, ...arg, i);

      let triple = output[key];
      if (!triple) {
        triple = [[], key, i];
        i += 1;
        output[key] = triple;
      }
      triple[0].push(row);
    }
    return new Wrapper(Object.values(output));
  }

  // ///////////////////////////////////////////////////////////////////////////
  // TERMINAL METHODS
  // ///////////////////////////////////////////////////////////////////////////

  toArray() {
    return Array.from(this);
  }

  fromPairs() {
    // return an object from (value, key) pairs
    const output = {};
    for (const [v, k] of this.argslist) {
      output[k] = v;
    }
    return output;
  }

  first() {
    // return first element
    return first(this);
  }

  last() {
    // return last element
    return last(this);
  }

  index(column) {
    // Return an object indexed on `column`
    // We assume the key is unique
    const output = {};
    for (const [row] of this.argslist) {
      const key = row[column];
      const value = output[key];
      if (value === undefined) {
        output[key] = row;
      } else {
        throw new Error('expecting index to be unique');
      }
    }
    return output;
  }
}

const frum = (list) => {
  if (list instanceof Wrapper) {
    return list;
  } if (Array.isArray(list)) {
    return new Wrapper(list.map(v => [v]));
  }
    return new Wrapper(Array.from(list));

};
internalFrum = frum;


const toPairs = (obj) => {
  if (obj instanceof Map) {
    return new Wrapper(Array.from(obj.entries()).map(([k, v]) => [v, k]));
  }
    return new Wrapper(Object.entries(obj).map(([k, v]) => [v, k]));

};


// Add a chainable method to Wrapper
const extend_wrapper = (methods) => {
  toPairs(methods).map((method, name) => {
    // USE function(){} DECLARATION TO BIND this AT CALL TIME
    Wrapper.prototype[name] = function anonymous(...args) {
      return frum(method(this.toArray(), ...args));
    };
    return null;
  });
};


// Add Lodash functions
extend_wrapper({
  flatten: flatten,
  chunk: chunk,
  unzip: unzip,
  zip: unzip,
  sortBy: sortBy,
  sort: sortBy,
  limit: lodashTake,

  // SELECT a.*, b.* FROM listA a LEFT JOIN listB b on b[propB]=a[propA]
  join: function join(listA, propA, listB, propB) {
    const lookup = frum(listB).groupBy(propB).fromPairs();

    return frum(listA)
      .map(rowA => lookup[rowA[propA]].map(rowB => ({ ...rowB, ...rowA })))
      .flatten();
  },

  append: function append(list, value) {
    return [...list, value];
  },

  reverse: function reverse(list) {
    return list.reverse();
  },
});

export { frum, toPairs, first, last };
