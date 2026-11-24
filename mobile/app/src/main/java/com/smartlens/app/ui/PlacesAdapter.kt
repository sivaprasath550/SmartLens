package com.smartlens.app.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.view.isVisible
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.smartlens.app.R
import com.smartlens.app.databinding.ItemPlaceBinding
import com.smartlens.app.util.Format

class PlacesAdapter(private val onClick: (Place) -> Unit) :
    ListAdapter<Place, PlacesAdapter.ViewHolder>(DIFF) {

    class ViewHolder(val binding: ItemPlaceBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder =
        ViewHolder(ItemPlaceBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val place = getItem(position)
        with(holder.binding) {
            placeNumber.text = (position + 1).toString()
            placeNumber.setBackgroundResource(
                if (place.simulated) R.drawable.bg_place_number_demo else R.drawable.bg_place_number,
            )
            placeName.text = place.name
            placeCategory.text = place.category
            placeAddress.text = place.address
            placeAddress.isVisible = !place.address.isNullOrBlank()
            placeDistance.text = Format.distance(place.distanceMeters)
            root.setOnClickListener { onClick(place) }
        }
    }

    companion object {
        private val DIFF = object : DiffUtil.ItemCallback<Place>() {
            override fun areItemsTheSame(oldItem: Place, newItem: Place) = oldItem.id == newItem.id

            override fun areContentsTheSame(oldItem: Place, newItem: Place) = oldItem == newItem
        }
    }
}
