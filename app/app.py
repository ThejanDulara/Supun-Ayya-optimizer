from flask import Flask, request, jsonify
from flask_cors import CORS
from scipy.optimize import linprog
import os

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/api/optimize', methods=['POST'])
def optimize():
    data = request.json
    try:
        T = float(data.get('total_duration', 0))
        brands = data.get('brands', [])
        
        flat_comms = []
        for i, b in enumerate(brands):
            budget_pct = float(b.get('budget_pct', 0)) / 100.0
            for j, c in enumerate(b.get('commercials', [])):
                weight_pct = float(c.get('weight_pct', 0)) / 100.0
                flat_comms.append({
                    "brand_idx": i,
                    "brand_name": b.get('name', f'Brand {i+1}'),
                    "duration": float(c.get('duration', 0)),
                    "weight_pct": weight_pct,
                    "budget_pct": budget_pct,
                })

        if not flat_comms:
            return jsonify({"error": "No commercials provided"}), 400

        n = len(flat_comms)
        c_opt = [-item['duration'] for item in flat_comms]
        
        A_ub = []
        b_ub = []
        
        # 1. Total duration <= T
        A_ub.append([item['duration'] for item in flat_comms])
        b_ub.append(T)
        
        # 2. Brand level duration <= T * B_i
        for i in range(len(brands)):
            row = [item['duration'] if item['brand_idx'] == i else 0 for item in flat_comms]
            A_ub.append(row)
            b_ub.append(T * (float(brands[i].get('budget_pct', 0)) / 100.0))
            
        # Bounds
        bounds = []
        for item in flat_comms:
            max_duration = T * item['budget_pct'] * item['weight_pct']
            max_spots = max_duration / item['duration'] if item['duration'] > 0 else 0
            bounds.append((0, max_spots))

        res = linprog(c_opt, A_ub=A_ub, b_ub=b_ub, bounds=bounds, method='highs')
        
        if res.success:
            results = []
            total_actual_duration = 0
            
            for idx, item in enumerate(flat_comms):
                spots = float(res.x[idx])
                actual_dur = spots * item['duration']
                max_dur = T * item['budget_pct'] * item['weight_pct']
                
                results.append({
                    "brand": item['brand_name'],
                    "duration": item['duration'],
                    "spots": spots,
                    "spots_rounded": round(spots),
                    "actual_duration": actual_dur,
                    "max_duration": max_dur
                })
                total_actual_duration += actual_dur

            return jsonify({
                "success": True,
                "total_actual_duration": total_actual_duration,
                "results": results
            })
        else:
            return jsonify({"error": "Optimization failed", "details": res.message}), 500

    except Exception as e:
        return jsonify({"error": str(e)}), 400

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=False, host='0.0.0.0', port=port)
